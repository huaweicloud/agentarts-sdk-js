import { createHash, randomUUID, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, open, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { ExecutionError, boundedInteger } from './execution.js';

export interface StoredProtocolRecord<T = unknown> { key: string; value: T }
/** Updates must be atomic for one scope/key. Update callbacks must have no external side effects. */
export interface ProtocolStorage {
  get<T>(scope: string, key: string): Promise<T | undefined>;
  update<T>(scope: string, key: string, change: (previous: T | undefined) => T | undefined): Promise<T | undefined>;
  list<T>(scope: string): Promise<StoredProtocolRecord<T>[]>;
}
export interface ProtocolStorageOptions { maxRecords?: number; maxRecordBytes?: number; maxTotalBytes?: number }
export function protocolSnapshot<T>(value: T, maximum = 2 * 1024 * 1024): T {
  const seen = new Set<object>();
  let nodes = 0;
  const check = (item: unknown, depth: number): void => {
    if (++nodes > 50000 || depth > 64) throw new ExecutionError('INPUT_LIMIT', 'Protocol record complexity limit');
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
    if (!item || typeof item !== 'object' || seen.has(item)) throw new ExecutionError('INVALID_INPUT', 'Protocol records must be JSON');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw new ExecutionError('INVALID_INPUT', 'Protocol records must be plain JSON');
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ExecutionError('INVALID_INPUT', 'Unsafe protocol key');
      if (child === undefined && !Array.isArray(item)) continue;
      check(child, depth + 1);
    }
    seen.delete(item);
  };
  check(value, 0);
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded) > maximum) throw new ExecutionError('INPUT_LIMIT', 'Protocol record size limit');
  return JSON.parse(encoded) as T;
}
export function protocolFingerprint(value: unknown): string {
  const snapshot = protocolSnapshot(value, 4 * 1024 * 1024);
  const stable = (item: any): string => item && typeof item === 'object'
    ? Array.isArray(item) ? `[${item.map(stable).join(',')}]` : `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${stable(item[key])}`).join(',')}}`
    : JSON.stringify(item);
  return createHash('sha256').update(stable(snapshot)).digest('hex');
}
const queues = new Map<string, Promise<unknown>>();
async function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(operation);
  queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}
const identity = (scope: string, key: string) => createHash('sha256').update(JSON.stringify([scope, key])).digest('hex');

export class MemoryProtocolStorage implements ProtocolStorage {
  private readonly records = new Map<string, { scope: string; key: string; value: unknown; bytes: number }>();
  private readonly maximum: number;
  private readonly bytes: number;
  private readonly totalBytes: number;
  private readonly id = randomUUID();
  constructor(options: ProtocolStorageOptions = {}) {
    this.maximum = boundedInteger(options.maxRecords ?? 1024, 'maxRecords');
    this.bytes = boundedInteger(options.maxRecordBytes ?? 4 * 1024 * 1024, 'maxRecordBytes');
    this.totalBytes = boundedInteger(options.maxTotalBytes ?? 64 * 1024 * 1024, 'maxTotalBytes');
  }
  async get<T>(scope: string, key: string): Promise<T | undefined> {
    const value = this.records.get(identity(scope, key));
    return value ? protocolSnapshot(value.value, this.bytes) as T : undefined;
  }
  update<T>(scope: string, key: string, change: (previous: T | undefined) => T | undefined): Promise<T | undefined> {
    return serial(this.id, async () => {
      const id = identity(scope, key);
      const next = change(await this.get<T>(scope, key));
      if (next === undefined) { this.records.delete(id); return undefined; }
      const value = protocolSnapshot(next, this.bytes);
      if (!this.records.has(id) && this.records.size >= this.maximum) throw new ExecutionError('CAPACITY', 'Protocol storage full');
      const bytes = Buffer.byteLength(JSON.stringify(value));
      if ([...this.records.entries()].reduce((sum, [key, record]) => sum + (key === id ? 0 : record.bytes), bytes) > this.totalBytes) throw new ExecutionError('CAPACITY', 'Protocol storage byte limit');
      this.records.set(id, { scope, key, value, bytes });
      return protocolSnapshot(value, this.bytes);
    });
  }
  async list<T>(scope: string): Promise<StoredProtocolRecord<T>[]> {
    return [...this.records.values()].filter(record => record.scope === scope).map(record => ({ key: record.key, value: protocolSnapshot(record.value, this.bytes) as T }));
  }
}

/** Atomic local persistence. One OS process per directory; distributed adapters implement ProtocolStorage. */
export class FileProtocolStorage implements ProtocolStorage {
  private readonly directory: string;
  private readonly maximum: number;
  private readonly bytes: number;
  private readonly totalBytes: number;
  private readonly encryptionKey?: Buffer;
  private readonly ready: Promise<void>;
  constructor(directory: string, options: ProtocolStorageOptions & { encryptionKey?: Uint8Array } = {}) {
    this.directory = resolve(directory, 'agentarts-protocol-state');
    this.maximum = boundedInteger(options.maxRecords ?? 1024, 'maxRecords');
    this.bytes = boundedInteger(options.maxRecordBytes ?? 4 * 1024 * 1024, 'maxRecordBytes');
    this.totalBytes = boundedInteger(options.maxTotalBytes ?? 64 * 1024 * 1024, 'maxTotalBytes');
    if (options.encryptionKey) {
      if (options.encryptionKey.length !== 32) throw new TypeError('Storage encryption key must be 32 bytes');
      this.encryptionKey = Buffer.from(options.encryptionKey);
    }
    const directoryPath = this.directory;
    this.ready = serial(directoryPath, async () => {
      await mkdir(directoryPath, { recursive: true, mode: 0o700 });
      const info = await lstat(directoryPath);
      if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077)) throw new Error('Protocol storage directory must be private (0700)');
      // Serialized with writers in this OS process: only incomplete atomic writes
      // from a previous crash can remain when this initialization runs.
      for (const file of await readdir(directoryPath)) if (/^[a-f0-9-]{36}\.tmp$/.test(file)) await unlink(join(directoryPath, file));
    });
    void this.ready.catch(() => {});
  }
  private async entries(): Promise<string[]> {
    await this.ready;
    const files = (await readdir(this.directory)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
    if (files.length > this.maximum) throw new ExecutionError('CAPACITY', 'Protocol storage exceeds record limit');
    return files;
  }
  private async read(file: string): Promise<{ scope: string; key: string; value: unknown } | undefined> {
    try {
      const handle = await open(join(this.directory, file), constants.O_RDONLY | constants.O_NOFOLLOW);
      let encoded: string;
      try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > this.bytes * 2 + 4096) throw new Error('Invalid protocol storage record');
        encoded = await handle.readFile('utf8');
      } finally { await handle.close(); }
      const envelope = JSON.parse(encoded);
      if (envelope.encrypted) {
        if (!this.encryptionKey) throw new Error('Storage encryption key required');
        const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(envelope.iv, 'base64'));
        decipher.setAAD(Buffer.from(file));
        decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
        encoded = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
      } else if (this.encryptionKey) throw new Error('Expected encrypted protocol storage');
      const record = protocolSnapshot(JSON.parse(encoded), this.bytes + 4096);
      if (identity(record.scope, record.key) + '.json' !== file) throw new Error('Protocol record identity mismatch');
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  async get<T>(scope: string, key: string): Promise<T | undefined> {
    await this.ready;
    return (await this.read(identity(scope, key) + '.json'))?.value as T | undefined;
  }
  update<T>(scope: string, key: string, change: (previous: T | undefined) => T | undefined): Promise<T | undefined> {
    return serial(this.directory, async () => {
      const files = await this.entries();
      const file = identity(scope, key) + '.json';
      const next = change(await this.get<T>(scope, key));
      if (next === undefined) { await unlink(join(this.directory, file)).catch(error => { if (error.code !== 'ENOENT') throw error; }); return undefined; }
      const value = protocolSnapshot(next, this.bytes);
      if (!files.includes(file) && files.length >= this.maximum) throw new ExecutionError('CAPACITY', 'Protocol storage full');
      let encoded = JSON.stringify({ scope, key, value });
      if (this.encryptionKey) {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        cipher.setAAD(Buffer.from(file));
        const data = Buffer.concat([cipher.update(encoded, 'utf8'), cipher.final()]);
        encoded = JSON.stringify({ encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
      }
      let total = Buffer.byteLength(encoded);
      for (const existing of files) if (existing !== file) total += (await lstat(join(this.directory, existing))).size;
      if (total > this.totalBytes) throw new ExecutionError('CAPACITY', 'Protocol storage byte limit');
      const temporary = join(this.directory, `${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(encoded);
        await handle.sync();
        await handle.close();
        await rename(temporary, join(this.directory, file));
        const parent = await open(this.directory, constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
      } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
      return protocolSnapshot(value, this.bytes);
    });
  }
  async list<T>(scope: string): Promise<StoredProtocolRecord<T>[]> {
    const result: StoredProtocolRecord<T>[] = [];
    for (const file of await this.entries()) {
      const record = await this.read(file);
      if (record?.scope === scope) result.push({ key: record.key, value: record.value as T });
    }
    return result;
  }
}

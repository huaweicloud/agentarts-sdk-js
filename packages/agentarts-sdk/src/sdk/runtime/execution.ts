import { createHash, randomUUID } from 'node:crypto';

export interface ExecutionPrincipal {
  readonly tenantId: string;
  readonly subject: string;
}
export interface ExecutionOutcome {
  readonly state: 'completed' | 'failed' | 'canceled';
  readonly output?: string;
}
type ExecutionEventPayload =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'finished'; readonly outcome: ExecutionOutcome };
export type ExecutionEvent = ExecutionEventPayload & { readonly sequence: number };
export interface ExecutionContext {
  readonly executionId: string;
  readonly principal: ExecutionPrincipal;
  readonly signal: AbortSignal;
  emitText(delta: string): void;
}
/** Resolves/rejects only after actual execution AND resource cleanup have finished. */
export type TextExecutor = (
  input: unknown,
  context: ExecutionContext,
) => string | void | Promise<string | void>;
export interface ExecutionHandle {
  readonly executionId: string;
  readonly input: unknown;
  readonly key: string;
  readonly output: string;
  readonly sequence: number;
  /** Timestamp of the most recent execution status transition. */
  readonly updatedAt: number;
  readonly done: Promise<ExecutionOutcome>;
  readonly outcome: ExecutionOutcome | undefined;
  cancel(): Promise<ExecutionOutcome>;
  events(after?: number, signal?: AbortSignal): AsyncIterableIterator<ExecutionEvent>;
}
export class ExecutionError extends Error {
  constructor(
    readonly code:
      | 'INVALID_INPUT'
      | 'INPUT_LIMIT'
      | 'CONFLICT'
      | 'NOT_FOUND'
      | 'CAPACITY'
      | 'HISTORY_LOST'
      | 'OUTPUT_LIMIT',
    message: string,
  ) {
    super(message);
    this.name = 'ExecutionError';
  }
}
export interface ExecutionLimits {
  maxExecutions?: number;
  maxExecutionsPerPrincipal?: number;
  maxActivePerPrincipal?: number;
  maxEvents?: number;
  maxHistoryBytes?: number;
  maxOutputBytes?: number;
  maxSubscribers?: number;
  retentionMs?: number;
  executionTimeoutMs?: number;
}
export function boundedInteger(
  value: number,
  name: string,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum)
    throw new RangeError(`${name} must be a positive bounded integer`);
  return value;
}
export function requireIdentifier(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ExecutionError('INVALID_INPUT', `Invalid ${name}`);
  }
  return value;
}
function canonical(value: unknown, depth = 0): string {
  if (depth > 64) throw new ExecutionError('INVALID_INPUT', 'Input nesting limit exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`,
      )
      .join(',')}}`;
  }
  throw new ExecutionError('INVALID_INPUT', 'Input must be JSON');
}
interface Entry {
  handle: ExecutionHandle;
  fingerprint: string;
  scope: string;
  completedAt?: number;
}

/** Single-process ownership and replay. No dependency on any wire protocol. */
export class ExecutionCoordinator {
  private readonly entries = new Map<string, Entry>();
  private readonly limits: Required<ExecutionLimits>;
  constructor(
    private readonly acquire: () => { release(): void },
    limits: ExecutionLimits = {},
  ) {
    this.limits = {
      maxExecutions: 64,
      maxExecutionsPerPrincipal: 16,
      maxActivePerPrincipal: 8,
      maxEvents: 256,
      maxHistoryBytes: 256 * 1024,
      maxOutputBytes: 128 * 1024,
      maxSubscribers: 16,
      retentionMs: 300000,
      executionTimeoutMs: 120000,
      ...limits,
    };
    for (const [name, value] of Object.entries(this.limits)) boundedInteger(value, name);
    if (this.limits.maxHistoryBytes < 256)
      throw new RangeError('maxHistoryBytes must be at least 256');
    boundedInteger(this.limits.executionTimeoutMs, 'executionTimeoutMs', 2147483647);
  }
  private key(principal: ExecutionPrincipal, key: string): string {
    return JSON.stringify([
      requireIdentifier(principal.tenantId, 'tenantId'),
      requireIdentifier(principal.subject, 'subject'),
      key,
    ]);
  }
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.completedAt !== undefined && now - entry.completedAt >= this.limits.retentionMs)
        this.entries.delete(key);
    }
  }
  get(principal: ExecutionPrincipal, key: string): ExecutionHandle {
    const entry = this.entries.get(this.key(principal, key));
    if (
      !entry ||
      (entry.completedAt !== undefined && Date.now() - entry.completedAt >= this.limits.retentionMs)
    ) {
      throw new ExecutionError('NOT_FOUND', 'Execution not found');
    }
    return entry.handle;
  }
  getById(principal: ExecutionPrincipal, executionId: string): ExecutionHandle {
    const scope = this.key(principal, '');
    for (const entry of this.entries.values()) {
      if (
        entry.scope === scope &&
        entry.handle.executionId === executionId &&
        (entry.completedAt === undefined ||
          Date.now() - entry.completedAt < this.limits.retentionMs)
      )
        return entry.handle;
    }
    throw new ExecutionError('NOT_FOUND', 'Execution not found');
  }
  /** Lists only unexpired records owned by the verified principal. */
  list(principal: ExecutionPrincipal): ExecutionHandle[] {
    const scope = this.key(principal, '');
    const now = Date.now();
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.scope === scope &&
          (entry.completedAt === undefined || now - entry.completedAt < this.limits.retentionMs),
      )
      .map((entry) => entry.handle);
  }
  start(
    principal: ExecutionPrincipal,
    key: string,
    input: unknown,
    execute: TextExecutor,
  ): ExecutionHandle {
    requireIdentifier(key, 'execution key');
    const scopedKey = this.key(principal, key);
    const encoded = canonical(input);
    if (Buffer.byteLength(encoded) > 1024 * 1024)
      throw new ExecutionError('INPUT_LIMIT', 'Input too large');
    const fingerprint = createHash('sha256').update(encoded).digest('hex');
    const snapshot: unknown = JSON.parse(encoded);
    const freeze = (value: unknown): void => {
      if (value && typeof value === 'object') {
        for (const item of Object.values(value)) freeze(item);
        Object.freeze(value);
      }
    };
    freeze(snapshot);
    const existing = this.entries.get(scopedKey);
    if (
      existing &&
      (existing.completedAt === undefined ||
        Date.now() - existing.completedAt < this.limits.retentionMs)
    ) {
      if (existing.fingerprint !== fingerprint)
        throw new ExecutionError(
          'CONFLICT',
          'Execution identifier already used with different input',
        );
      return existing.handle;
    }
    this.prune();
    if (this.entries.size >= this.limits.maxExecutions)
      throw new ExecutionError('CAPACITY', 'Execution registry full');
    const scope = this.key(principal, '');
    const owned = [...this.entries.values()].filter((entry) => entry.scope === scope);
    if (
      owned.length >= this.limits.maxExecutionsPerPrincipal ||
      owned.filter((entry) => entry.completedAt === undefined).length >=
        this.limits.maxActivePerPrincipal
    ) {
      throw new ExecutionError('CAPACITY', 'Principal execution capacity reached');
    }
    const lease = this.acquire();
    const controller = new AbortController();
    const owner = Object.freeze({ tenantId: principal.tenantId, subject: principal.subject });
    const executionId = randomUUID();
    const history: ExecutionEvent[] = [];
    const sizes: number[] = [];
    const waiters = new Set<() => void>();
    let historyBytes = 0,
      sequence = 0,
      outputBytes = 0,
      subscribers = 0;
    let outcome: ExecutionOutcome | undefined;
    let updatedAt = Date.now();
    const text: string[] = [];
    const wake = () => {
      for (const waiter of [...waiters]) waiter();
    };
    const publish = (event: ExecutionEventPayload) => {
      const record = Object.freeze({ ...event, sequence: sequence + 1 });
      const bytes = Buffer.byteLength(JSON.stringify(record));
      if (bytes > this.limits.maxHistoryBytes)
        throw new ExecutionError('OUTPUT_LIMIT', 'Event size limit exceeded');
      sequence++;
      history.push(record);
      sizes.push(bytes);
      historyBytes += bytes;
      while (history.length > this.limits.maxEvents || historyBytes > this.limits.maxHistoryBytes) {
        history.shift();
        historyBytes -= sizes.shift()!;
      }
      wake();
    };
    const emitText = (delta: string) => {
      if (outcome || controller.signal.aborted)
        throw new ExecutionError('CONFLICT', 'Execution is no longer accepting output');
      if (typeof delta !== 'string') throw new TypeError('Text output must be a string');
      if (!delta.length) return;
      const bytes = Buffer.byteLength(delta);
      if (outputBytes + bytes > this.limits.maxOutputBytes)
        throw new ExecutionError('OUTPUT_LIMIT', 'Output limit exceeded');
      // Validate the actual encoded event size before retaining/charging output.
      publish({ type: 'text', delta });
      outputBytes += bytes;
      text.push(delta);
    };
    let resolveDone!: (result: ExecutionOutcome) => void;
    const done = new Promise<ExecutionOutcome>((resolve) => {
      resolveDone = resolve;
    });
    const coordinator = this;
    const handle: ExecutionHandle = {
      executionId,
      input: snapshot,
      key,
      done,
      get output() {
        return outcome?.output ?? text.join('');
      },
      get sequence() {
        return sequence;
      },
      get updatedAt() {
        return updatedAt;
      },
      get outcome() {
        return outcome;
      },
      async cancel() {
        if (!outcome) controller.abort();
        return done;
      },
      events(after = 0, signal) {
        if (!Number.isSafeInteger(after) || after < 0 || after > sequence)
          throw new ExecutionError('INVALID_INPUT', 'Invalid event cursor');
        if (subscribers >= coordinator.limits.maxSubscribers)
          throw new ExecutionError('CAPACITY', 'Subscriber limit exceeded');
        subscribers++;
        const local = new AbortController();
        let released = false;
        const release = () => {
          if (!released) {
            released = true;
            subscribers--;
          }
        };
        const abort = () => {
          local.abort();
          release();
          signal?.removeEventListener('abort', abort);
          wake();
        };
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        let cursor = after;
        const iterator = (async function* () {
          try {
            while (!local.signal.aborted) {
              if (cursor < sequence) {
                const record = history.find((event) => event.sequence === cursor + 1);
                if (!record)
                  throw new ExecutionError('HISTORY_LOST', 'Event history no longer available');
                cursor = record.sequence;
                yield record;
              } else if (outcome) return;
              else
                await new Promise<void>((resolve) => {
                  const resume = () => {
                    waiters.delete(resume);
                    resolve();
                  };
                  waiters.add(resume);
                  if (local.signal.aborted || cursor < sequence || outcome) resume();
                });
            }
          } finally {
            release();
            signal?.removeEventListener('abort', abort);
          }
        })();
        return {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => iterator.next(),
          async return() {
            abort();
            try {
              return await iterator.return();
            } finally {
              release();
              signal?.removeEventListener('abort', abort);
            }
          },
        };
      },
    };
    const entry: Entry = { handle, fingerprint, scope: this.key(owner, '') };
    this.entries.set(scopedKey, entry);
    const timer = setTimeout(() => controller.abort(), this.limits.executionTimeoutMs);
    timer.unref();
    // Start in the background: consumers and HTTP connections do not drive it.
    void (async () => {
      try {
        const value = await execute(snapshot, {
          executionId,
          principal: owner,
          signal: controller.signal,
          emitText,
        });
        if (value !== undefined && typeof value !== 'string')
          throw new TypeError('Executor result must be text');
        if (typeof value === 'string' && Buffer.byteLength(value) > this.limits.maxOutputBytes)
          throw new ExecutionError('OUTPUT_LIMIT', 'Output limit exceeded');
        if (!text.length && value && !controller.signal.aborted) emitText(value);
        outcome = Object.freeze(
          controller.signal.aborted
            ? { state: 'canceled', ...(text.length ? { output: text.join('') } : {}) }
            : { state: 'completed', output: value ?? text.join('') },
        );
      } catch {
        outcome = Object.freeze({
          state: controller.signal.aborted ? 'canceled' : 'failed',
          ...(text.length ? { output: text.join('') } : {}),
        });
      } finally {
        clearTimeout(timer);
        text.length = 0;
        entry.completedAt = Date.now();
        updatedAt = entry.completedAt;
        lease.release();
        publish({ type: 'finished', outcome: Object.freeze({ state: outcome!.state }) });
        resolveDone(outcome!);
      }
    })();
    return handle;
  }
  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.completedAt === undefined)
        .map((entry) => entry.handle.cancel()),
    );
  }
}

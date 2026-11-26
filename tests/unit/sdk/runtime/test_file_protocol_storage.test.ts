import { chmod, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FileProtocolStorage } from 'agentarts-sdk/sdk/runtime';

it.skipIf(process.platform === 'win32')(
  'preserves POSIX checks and supports the Windows storage path',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentarts-storage-platform-'));
    const directory = join(root, 'agentarts-protocol-state');
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      await mkdir(directory, { mode: 0o755 });
      await chmod(directory, 0o755);
      await expect(new FileProtocolStorage(root).get('scope', 'key')).rejects.toThrow('0700');

      let store: FileProtocolStorage;
      let reopened: FileProtocolStorage;
      try {
        Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
        store = new FileProtocolStorage(root);
        reopened = new FileProtocolStorage(root);
      } finally {
        Object.defineProperty(process, 'platform', platform);
      }
      await store.update('scope', 'key', () => ({ checkpoint: 1 }));
      expect(await reopened.get('scope', 'key')).toEqual({ checkpoint: 1 });
      const name = (key: string) =>
        createHash('sha256')
          .update(JSON.stringify(['scope', key]))
          .digest('hex') + '.json';
      await symlink(name('key'), join(directory, name('link')));
      await expect(reopened.get('scope', 'link')).rejects.toThrow(
        'Invalid protocol storage record',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('serializes read-modify-write through aliases to the same directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentarts-storage-alias-'));
  try {
    const data = join(root, 'data');
    const alias = join(root, 'alias');
    await mkdir(data);
    await symlink(data, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const stores = [new FileProtocolStorage(data), new FileProtocolStorage(alias)];
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        stores[index % 2]!.update<number>('scope', 'counter', (value) => (value ?? 0) + 1),
      ),
    );
    expect(await stores[1]!.get('scope', 'counter')).toBe(20);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('keeps an initialized store on its original directory after an alias is redirected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentarts-storage-redirect-'));
  try {
    const original = join(root, 'original');
    const other = join(root, 'other');
    const alias = join(root, 'alias');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await mkdir(original);
    await mkdir(other);
    await symlink(original, alias, linkType);

    const opened = new FileProtocolStorage(alias);
    await opened.update('scope', 'key', () => 1);
    const second = new FileProtocolStorage(other);
    await second.update('scope', 'key', () => 100);

    await rm(alias);
    await symlink(other, alias, linkType);

    expect(await opened.update<number>('scope', 'key', (value) => value! + 1)).toBe(2);
    expect(await opened.list('scope')).toEqual([{ key: 'key', value: 2 }]);
    expect(await second.get('scope', 'key')).toBe(100);
    expect(await new FileProtocolStorage(alias).get('scope', 'key')).toBe(100);
    await opened.update('scope', 'key', () => undefined);
    expect(await new FileProtocolStorage(original).get('scope', 'key')).toBeUndefined();
    expect(await second.get('scope', 'key')).toBe(100);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

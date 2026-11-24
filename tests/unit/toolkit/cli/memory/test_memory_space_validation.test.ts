import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMemoryCommand } from 'agentarts-sdk/toolkit/cli/memory/commands';
import * as ops from 'agentarts-sdk/toolkit/operations/memory/index';
import { console } from 'agentarts-sdk/toolkit/utils/console';

beforeEach(() => {
  process.exitCode = 0;
  vi.spyOn(console, 'print').mockImplementation(() => undefined);
  vi.spyOn(console, 'printPlain').mockImplementation(() => undefined);
  vi.spyOn(ops, 'createSpace').mockResolvedValue(
    new ops.SpaceResult({ success: true, spaceId: 'space' }),
  );
  vi.spyOn(ops, 'getSpace').mockResolvedValue(
    new ops.SpaceResult({ success: true, space: { id: 'space' } }),
  );
  vi.spyOn(ops, 'updateSpace').mockResolvedValue(new ops.SpaceResult({ success: true }));
});
afterEach(() => {
  process.exitCode = 0;
});
const run = (args: string[]) =>
  buildMemoryCommand()
    .exitOverride()
    .configureOutput({ writeErr: () => undefined })
    .parseAsync(args, { from: 'user' });
describe('Memory space parameter and failure handling', () => {
  it.each([
    ['create', ' '],
    ['create', 'name', '--ttl', '0'],
    ['create', 'name', '--vpc-id', 'vpc'],
    ['create', 'name', '--tags', 'invalid'],
  ])('rejects invalid input %j before calling Operations', async (...args) => {
    await run(args);
    expect(process.exitCode).toBe(1);
    expect(ops.createSpace).not.toHaveBeenCalled();
  });
  it.each(['1.5', '12abc', '9007199254740992'])('rejects an invalid integer %s', async (value) => {
    await expect(run(['create', 'name', '--ttl', value])).rejects.toThrow();
    expect(ops.createSpace).not.toHaveBeenCalled();
  });
  it('gets details using only the space ID', async () => {
    await run(['get', 'space', '-o', 'json']);
    expect(ops.getSpace).toHaveBeenCalledWith('space', expect.any(Object));
    expect(process.exitCode).toBe(0);
  });
  it('does not print success after the SDK operation fails', async () => {
    vi.mocked(ops.getSpace).mockResolvedValue(
      new ops.SpaceResult({ success: false, error: 'denied' }),
    );
    await run(['get', 'space', '-o', 'json']);
    expect(process.exitCode).toBe(1);
    expect(console.printPlain).not.toHaveBeenCalled();
  });
  it('passes custom strategies when creating and extraction=false/name when updating', async () => {
    await run(['create', 'name', '--custom-strategies', '[{"type":"CUSTOM"}]']);
    expect(ops.createSpace).toHaveBeenCalledWith(
      'name',
      expect.objectContaining({ memoryStrategiesCustomized: [{ type: 'CUSTOM' }] }),
    );
    await run(['update', 'space', '--name', 'renamed', '--extract-enabled', 'false']);
    expect(ops.updateSpace).toHaveBeenCalledWith(
      'space',
      expect.objectContaining({ name: 'renamed', enableMemoryExtract: false }),
    );
  });
  it('rejects unsupported update network flags rather than silently ignoring them', async () => {
    await expect(run(['update', 'space', '--private'])).rejects.toThrow();
    expect(ops.updateSpace).not.toHaveBeenCalled();
  });
});

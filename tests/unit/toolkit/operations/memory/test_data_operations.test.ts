import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as operations from 'agentarts-sdk/toolkit/operations/memory/index';

const mocks = vi.hoisted(() => ({ client: {} as Record<string, any>, constructor: vi.fn() }));
vi.mock('agentarts-sdk/sdk/memory/index', async (original) => ({
  ...(await original<typeof import('agentarts-sdk/sdk/memory/index')>()),
  MemoryClient: vi.fn(function (options) {
    mocks.constructor(options);
    return mocks.client;
  }),
}));

beforeEach(() => {
  mocks.constructor.mockReset();
  mocks.client = {
    getSession: vi.fn().mockResolvedValue({ id: 'session' }),
    deleteMemory: vi.fn().mockResolvedValue(undefined),
    addMessages: vi.fn().mockResolvedValue({ ids: ['message'] }),
    close: vi.fn().mockResolvedValue(undefined),
  };
});

describe('Memory data operation boundary', () => {
  it('creates an authenticated SDK client and returns a structured success result', async () => {
    const result = await operations.getSession('space', 'session', {
      region: 'cn-southwest-2',
      apiKey: 'test-key',
      skipSslVerification: true,
    });
    expect(mocks.constructor).toHaveBeenCalledWith({
      regionName: 'cn-southwest-2',
      apiKey: 'test-key',
      verifySsl: false,
    });
    expect(result).toBeInstanceOf(operations.MemoryDataResult);
    expect(result).toMatchObject({ success: true, data: { id: 'session' }, error: null });
    expect(mocks.client.close).toHaveBeenCalledOnce();
  });

  it('converts SDK exceptions to results without throwing and always closes', async () => {
    mocks.client.getSession.mockRejectedValue(new Error('permission denied'));
    await expect(operations.getSession('space', 'session')).resolves.toMatchObject({
      success: false,
      error: 'permission denied',
    });
    expect(mocks.client.close).toHaveBeenCalledOnce();
  });

  it('wraps constructor failures without attempting cleanup on a missing client', async () => {
    mocks.constructor.mockImplementation(() => {
      throw new Error('configuration invalid');
    });
    await expect(operations.getSession('space', 'session')).resolves.toMatchObject({
      success: false,
      error: 'configuration invalid',
    });
    expect(mocks.client.close).not.toHaveBeenCalled();
  });

  it('represents void deletion results as success', async () => {
    await expect(operations.deleteMemory('space', 'memory')).resolves.toMatchObject({
      success: true,
      error: null,
    });
    expect(mocks.client.deleteMemory).toHaveBeenCalledWith('space', 'memory');
  });

  it('reports cleanup failures and preserves the original SDK error', async () => {
    mocks.client.getSession.mockRejectedValue(new Error('request failed'));
    mocks.client.close.mockRejectedValue(new Error('close failed'));
    const result = await operations.getSession('space', 'session');
    expect(result.success).toBe(false);
    expect(result.error).toContain('request failed');
    expect(result.error).toContain('close failed');
  });

  it('does not report success when cleanup fails after a successful call', async () => {
    mocks.client.close.mockRejectedValue(new Error('close failed'));
    await expect(operations.getSession('space', 'session')).resolves.toMatchObject({
      success: false,
      error: expect.stringContaining('close failed'),
    });
  });

  it('validates and converts messages within the operation, independent of the CLI', async () => {
    const result = await operations.addMessages('space', 'session', [
      { role: 'user', content: 'hello' },
    ]);
    expect(result.success).toBe(true);
    expect(mocks.client.addMessages.mock.calls[0][2][0].toDict()).toEqual({
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    });
    const invalid = await operations.addMessages('space', 'session', []);
    expect(invalid).toMatchObject({ success: false, error: 'Messages must be a non-empty array.' });
    expect(mocks.client.addMessages).toHaveBeenCalledOnce();
  });
});

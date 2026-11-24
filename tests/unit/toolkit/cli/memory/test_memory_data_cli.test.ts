import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMemoryCommand } from 'agentarts-sdk/toolkit/cli/memory/commands';
import { console } from 'agentarts-sdk/toolkit/utils/common';
import * as memoryOperations from 'agentarts-sdk/toolkit/operations/memory/index';
import {
  MemoryListFilter,
  MemorySearchFilter,
  TextMessage,
  ToolCallMessage,
  ToolResultMessage,
} from 'agentarts-sdk/sdk/memory/index';

const mocks = vi.hoisted(() => ({
  client: {} as Record<string, any>,
  constructor: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('agentarts-sdk/sdk/memory/index', async (original) => ({
  ...(await original<typeof import('agentarts-sdk/sdk/memory/index')>()),
  MemoryClient: vi.fn(function (options) {
    mocks.constructor(options);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/toolkit/plugins/memory/installer/utils', async (original) => ({
  ...(await original<typeof import('agentarts-sdk/toolkit/plugins/memory/installer/utils')>()),
  confirm: mocks.confirm,
}));

const methods = [
  'createMemory',
  'updateMemory',
  'createMemorySession',
  'listSessions',
  'getSession',
  'deleteSession',
  'addMessages',
  'listMessages',
  'getMessage',
  'getLastKMessages',
  'searchMemories',
  'listMemories',
  'getMemory',
  'deleteMemory',
];

beforeEach(() => {
  process.exitCode = 0;
  mocks.client = Object.fromEntries(
    [...methods, 'close'].map((name) => [name, vi.fn().mockResolvedValue(undefined)]),
  );
  mocks.constructor.mockClear();
  mocks.confirm.mockReset().mockResolvedValue(false);
  vi.spyOn(console, 'print').mockImplementation(() => undefined);
  vi.spyOn(console, 'printPlain').mockImplementation(() => undefined);
});
afterEach(() => {
  process.exitCode = 0;
});

async function run(args: string[]) {
  await buildMemoryCommand().exitOverride().parseAsync(args, { from: 'user' });
}

describe('Memory data-plane CLI', () => {
  it('delegates to the operation layer and renders its result without constructing an SDK client', async () => {
    const operation = vi
      .spyOn(memoryOperations, 'getSession')
      .mockResolvedValue(
        new memoryOperations.MemoryDataResult({ success: true, data: { id: 'session' } as any }),
      );
    await run(['get-session', 'space', 'session', '-r', 'cn-southwest-2', '-k']);
    expect(operation).toHaveBeenCalledWith(
      'space',
      'session',
      expect.objectContaining({
        region: 'cn-southwest-2',
        skipSslVerification: true,
      }),
    );
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(JSON.parse(vi.mocked(console.printPlain).mock.calls[0][0] as string)).toEqual({
      id: 'session',
    });
  });

  it('reports a structured operation failure without printing success output', async () => {
    vi.spyOn(memoryOperations, 'getSession').mockResolvedValue(
      new memoryOperations.MemoryDataResult({ success: false, error: 'operation failed' }),
    );
    await run(['get-session', 'space', 'session']);
    expect(console.printPlain).not.toHaveBeenCalled();
    expect(console.print).toHaveBeenCalledWith(expect.stringContaining('operation failed'));
    expect(process.exitCode).toBe(1);
  });

  it.each([
    [
      ['create-session', 'space'],
      'createMemorySession',
      ['space', undefined, undefined, undefined, undefined],
    ],
    [
      ['list-sessions', 'space', '--actor-id', 'user', '--limit', '3', '--offset', '2'],
      'listSessions',
      ['space', 'user', 3, 2],
    ],
    [['get-session', 'space', 'session'], 'getSession', ['space', 'session']],
    [['delete-session', 'space', 'session', '--force'], 'deleteSession', ['space', 'session']],
    [
      ['list-messages', 'space', '--session-id', 'session'],
      'listMessages',
      ['space', 'session', 10, 0],
    ],
    [['get-message', 'space', 'session', 'message'], 'getMessage', ['message', 'space', 'session']],
    [
      ['last-messages', 'space', 'session', '--k', '5'],
      'getLastKMessages',
      ['session', 5, 'space'],
    ],
    [
      [
        'create-memory',
        'space',
        '--request',
        '{"content":"hello","strategy_type":"SEMANTIC","strategy_id":"strategy"}',
      ],
      'createMemory',
      ['space', { content: 'hello', strategy_type: 'SEMANTIC', strategy_id: 'strategy' }],
    ],
    [
      [
        'update-memory',
        'space',
        'memory',
        '--request',
        '{"content":"updated","extraction_meta":{}}',
      ],
      'updateMemory',
      ['space', 'memory', { content: 'updated', extraction_meta: {} }],
    ],
    [['get-memory', 'space', 'memory'], 'getMemory', ['space', 'memory']],
    [['delete-memory', 'space', 'memory', '--force'], 'deleteMemory', ['space', 'memory']],
  ] as Array<[string[], string, unknown[]]>)('%j routes to %s', async (args, method, expected) => {
    await run(args);
    expect(mocks.client[method]).toHaveBeenCalledWith(...expected);
    expect(mocks.client.close).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(0);
  });

  it('passes region, TLS, session identifiers and JSON metadata', async () => {
    await run([
      'create-session',
      'space',
      '--session-id',
      'session',
      '--actor-id',
      'user',
      '--assistant-id',
      'assistant',
      '--meta',
      '{"title":"test"}',
      '-r',
      'cn-southwest-2',
      '-k',
    ]);
    expect(mocks.constructor).toHaveBeenCalledWith({
      regionName: 'cn-southwest-2',
      apiKey: undefined,
      verifySsl: false,
    });
    expect(mocks.client.createMemorySession).toHaveBeenCalledWith(
      'space',
      'session',
      'user',
      'assistant',
      { title: 'test' },
    );
  });

  it('constructs all supported message types and passes write options', async () => {
    await run([
      'add-messages',
      'space',
      'session',
      '--messages',
      JSON.stringify([
        { role: 'user', content: 'Hello' },
        { type: 'tool_call', id: 'call', name: 'sum', arguments: { a: 1 } },
        { type: 'tool_result', toolCallId: 'call', content: '1' },
      ]),
      '--timestamp',
      '123',
      '--idempotency-key',
      'key',
      '--force-extract',
    ]);
    const [space, session, messages, options] = mocks.client.addMessages.mock.calls[0];
    expect([space, session]).toEqual(['space', 'session']);
    expect(messages[0]).toBeInstanceOf(TextMessage);
    expect(messages[1]).toBeInstanceOf(ToolCallMessage);
    expect(messages[1].arguments).toBe('{"a":1}');
    expect(messages[2]).toBeInstanceOf(ToolResultMessage);
    expect(options).toEqual({ timestamp: 123, idempotencyKey: 'key', isForceExtract: true });
  });

  it('converts search and list filters from API JSON fields', async () => {
    await run([
      'search-memories',
      'space',
      '--query',
      'budget',
      '--filters',
      '{"actor_id":"user","top_k":3,"rerank":false}',
    ]);
    const search = mocks.client.searchMemories.mock.calls[0][1];
    expect(search).toBeInstanceOf(MemorySearchFilter);
    expect(search.toDict()).toMatchObject({
      query: 'budget',
      actor_id: 'user',
      top_k: 3,
      rerank: false,
    });
    await run([
      'list-memories',
      'space',
      '--limit',
      '4',
      '--filters',
      '{"session_id":"session","sort_order":"desc"}',
    ]);
    const args = mocks.client.listMemories.mock.calls[0];
    expect(args.slice(0, 3)).toEqual(['space', 4, 0]);
    expect(args[3]).toBeInstanceOf(MemoryListFilter);
    expect(args[3].toDict()).toEqual({ session_id: 'session', sort_order: 'desc' });
  });

  it.each(['delete-session', 'delete-memory'])(
    'cancels %s without creating a client',
    async (command) => {
      await run([command, 'space', 'resource']);
      expect(mocks.confirm).toHaveBeenCalledWith(expect.any(String), false);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );

  it('executes a confirmed deletion', async () => {
    mocks.confirm.mockResolvedValue(true);
    await run(['delete-session', 'space', 'session']);
    expect(mocks.client.deleteSession).toHaveBeenCalledWith('space', 'session');
  });

  it.each(['not-json', '[]', '[{"type":"unknown"}]', '[{"content":""}]'])(
    'rejects invalid messages %s',
    async (value) => {
      await run(['add-messages', 'space', 'session', '--messages', value]);
      expect(mocks.client.addMessages).not.toHaveBeenCalled();
      if (value === 'not-json') {
        expect(mocks.constructor).not.toHaveBeenCalled();
      } else {
        expect(mocks.client.close).toHaveBeenCalledOnce();
      }
      expect(process.exitCode).toBe(1);
    },
  );

  it('reports SDK failures and still closes the client', async () => {
    mocks.client.getSession.mockRejectedValue(new Error('permission denied'));
    await run(['get-session', 'space', 'session']);
    expect(console.print).toHaveBeenCalledWith(expect.stringContaining('permission denied'));
    expect(mocks.client.close).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('prints model responses as API JSON', async () => {
    mocks.client.getSession.mockResolvedValue({
      toDict: () => ({ id: 'session', actor_id: 'user' }),
    });
    await run(['get-session', 'space', 'session', '-o', 'json']);
    expect(JSON.parse(vi.mocked(console.printPlain).mock.calls[0][0] as string)).toEqual({
      id: 'session',
      actor_id: 'user',
    });
  });

  it.each(['-1', '1.5', 'abc', '0'])(
    'rejects invalid page limit %s before SDK calls',
    async (value) => {
      await expect(run(['list-sessions', 'space', '--limit', value])).rejects.toThrow();
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
});

describe('direct Memory record write validation', () => {
  it.each(['[]', 'null', '"text"', 'false', '{bad'])(
    'rejects non-object write body %s before SDK calls',
    async (body) => {
      await run(['create-memory', 'space', '--request', body]);
      expect(process.exitCode).toBe(1);
      expect(mocks.client.createMemory).not.toHaveBeenCalled();
    },
  );
});

describe('Memory search optional SDK parameters', () => {
  it('allows SDK-default filters and preserves a query supplied in filter JSON', async () => {
    await run(['search-memories', 'space']);
    expect(mocks.client.searchMemories).toHaveBeenLastCalledWith('space', undefined);
    await run(['search-memories', 'space', '--filters', '{"query":"from filters"}']);
    expect(mocks.client.searchMemories.mock.calls[1][1].toDict().query).toBe('from filters');
  });
});

describe('Memory filter types', () => {
  it.each([
    '{"top_k":"3"}',
    '{"rerank":"false"}',
    '{"actorId":"ignored"}',
    '{"memory_type":"invalid"}',
  ])('rejects malformed search filters %s instead of sending or dropping them', async (filters) => {
    await run(['search-memories', 'space', '--filters', filters]);
    expect(process.exitCode).toBe(1);
    expect(mocks.client.searchMemories).not.toHaveBeenCalled();
  });
});

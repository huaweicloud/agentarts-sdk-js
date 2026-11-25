import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { AgentArtsRuntimeApp, type TextExecutor } from 'agentarts-sdk/sdk/runtime';
import { createA2aAdapter } from '../../packages/agentarts-protocol-a2a/src/index.js';
import { createAguiAdapter } from '../../packages/agentarts-protocol-agui/src/index.js';

const a2aRequire = createRequire(
  new URL('../../packages/agentarts-protocol-a2a/package.json', import.meta.url),
);
const aguiRequire = createRequire(
  new URL('../../packages/agentarts-protocol-agui/package.json', import.meta.url),
);
const { AgentCard } = await import(a2aRequire.resolve('@a2a-js/sdk'));
const a2aModels = await import(a2aRequire.resolve('@a2a-js/sdk'));
const a2aClient = await import(a2aRequire.resolve('@a2a-js/sdk/client'));
const aguiClient = await import(aguiRequire.resolve('@ag-ui/client'));
const { RunAgentInputSchema, EventSchema } = await import(
  aguiRequire.resolve('@ag-ui/core/schemas')
);
const servers: Array<{ app: AgentArtsRuntimeApp; server: Server }> = [];
afterEach(async () => {
  for (const { app, server } of servers.splice(0)) {
    await app.executions.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function setup(
  execute: TextExecutor = () => 'hello',
  routingTenant?: string,
  options: ConstructorParameters<typeof AgentArtsRuntimeApp>[0] = {},
) {
  const app = new AgentArtsRuntimeApp(options);
  const server = app.run('127.0.0.1', 0);
  servers.push({ app, server });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const authenticate = ({ headers }: { headers: Readonly<Record<string, unknown>> }) =>
    headers.authorization === 'Bearer local-test'
      ? { tenantId: 'verified-tenant', subject: 'user' }
      : headers.authorization === 'Bearer other-user'
        ? { tenantId: 'verified-tenant', subject: 'other' }
        : headers.authorization === 'Bearer other-tenant'
          ? { tenantId: 'other-tenant', subject: 'user' }
          : null;
  app.use(
    createA2aAdapter({
      authenticate,
      execute,
      agentCard: AgentCard.fromJSON({
        name: 'Conformance test',
        version: '1.0.0',
        supportedInterfaces: [
          {
            url: url + '/a2a',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
            ...(routingTenant ? { tenant: routingTenant } : {}),
          },
        ],
        securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
        securityRequirements: [{ schemes: { bearer: { list: [] } } }],
        skills: [{ id: 'text', name: 'Text', description: 'Text only', tags: ['text'] }],
      }),
    }),
  );
  app.use(createAguiAdapter({ authenticate, execute }));
  const post = (path: string, body: unknown, token = 'local-test') =>
    fetch(url + path, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'a2a-version': '1.0',
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  return { app, post, url };
}
function rpc(method: string, params: unknown = {}) {
  return { jsonrpc: '2.0', id: 'acceptance', method, params };
}
function message(overrides: Record<string, unknown> = {}) {
  return { messageId: 'message', role: 'ROLE_USER', parts: [{ text: 'hello' }], ...overrides };
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    threadId: 'thread',
    runId: 'run',
    messages: [{ id: 'user', role: 'user', content: 'hello' }],
    ...overrides,
  };
}
async function events(response: globalThis.Response): Promise<any[]> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const result = (await response.text())
    .split('\n\n')
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => JSON.parse(frame.slice(5).trim()));
  for (const event of result) expect(EventSchema.safeParse(event).success).toBe(true);
  return result;
}
async function json(response: globalThis.Response): Promise<any> {
  return response.json();
}

it('AGUI accepts minimal input with omitted optional tools, context and state', async () => {
  const { post } = await setup();
  const stream = await events(await post('/ag-ui', input()));
  expect(stream[0]).toMatchObject({ type: 'RUN_STARTED', runId: 'run', protocolVersion: '1.0' });
  expect(stream.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'success' } });
});

it('AGUI preserves ordered Unicode deltas and closes the message before its run', async () => {
  const { post } = await setup(async (_input, context) => {
    context.emitText('你好');
    await new Promise((resolve) => setTimeout(resolve, 10));
    context.emitText(' 🌍\n');
  });
  const stream = await events(await post('/ag-ui', input()));
  expect(
    stream
      .filter((event) => event.type === 'TEXT_MESSAGE_CONTENT')
      .map((event) => event.delta)
      .join(''),
  ).toBe('你好 🌍\n');
  expect(stream.at(-2).type).toBe('TEXT_MESSAGE_END');
  expect(stream.at(-1).type).toBe('RUN_FINISHED');
});

it('AGUI supports a valid text ContentPart array', async () => {
  const body = input({
    messages: [{ id: 'user', role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  expect(RunAgentInputSchema.safeParse(body).success).toBe(true);
  const { post } = await setup();
  await events(await post('/ag-ui', body));
});

it('AGUI skips unusable image parts rather than failing a valid mixed-content run', async () => {
  const body = input({
    messages: [
      {
        id: 'user',
        role: 'user',
        content: [
          { type: 'text', text: 'hello' },
          { type: 'image', source: { type: 'url', value: 'https://example.invalid/image.png' } },
        ],
      },
    ],
  });
  expect(RunAgentInputSchema.safeParse(body).success).toBe(true);
  const { post } = await setup();
  await events(await post('/ag-ui', body));
});

it('AGUI accepts newer minor version declarations and declares its own version', async () => {
  const { post } = await setup();
  const stream = await events(await post('/ag-ui', input({ protocolVersion: '1.1' })));
  expect(stream[0].protocolVersion).toBe('1.0');
});

it('AGUI strips unknown protocol properties before invoking application code', async () => {
  const execute = vi.fn((_input: unknown) => 'hello');
  const { post } = await setup(execute);
  await events(await post('/ag-ui', input({ futureProtocolField: { enabled: true } })));
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).not.toHaveProperty('futureProtocolField');
});

it('AGUI preserves application-owned forwardedProps payloads untouched', async () => {
  const execute = vi.fn((_input: unknown) => 'hello');
  const { post } = await setup(execute);
  const forwardedProps = { custom: { nested: null, list: [1, true] } };
  await events(await post('/ag-ui', input({ forwardedProps })));
  expect(execute.mock.calls[0]?.[0]).toMatchObject({ forwardedProps });
});

it('AGUI reports execution failure with exactly one RUN_ERROR and no success', async () => {
  const { post } = await setup(() => {
    throw new Error('private-provider-secret');
  });
  const stream = await events(await post('/ag-ui', input()));
  expect(stream.filter((event) => event.type === 'RUN_ERROR')).toHaveLength(1);
  expect(stream.some((event) => event.type === 'RUN_FINISHED')).toBe(false);
  expect(JSON.stringify(stream)).not.toContain('private-provider-secret');
});

it('A2A GetTask retrieves a completed task with its output and honors zero history', async () => {
  const { post } = await setup();
  const created = await json(await post('/a2a', rpc('SendMessage', { message: message() })));
  const fetched = await json(
    await post('/a2a', rpc('GetTask', { id: created.result.task.id, historyLength: 0 })),
  );
  expect(fetched.result.status.state).toBe('TASK_STATE_COMPLETED');
  expect(fetched.result.artifacts[0].parts[0].text).toBe('hello');
  expect(fetched.result.history ?? []).toHaveLength(0);
});

it('A2A rejects subscribing to a terminal task with UnsupportedOperationError', async () => {
  const { post } = await setup();
  const created = await json(await post('/a2a', rpc('SendMessage', { message: message() })));
  const response = await post('/a2a', rpc('SubscribeToTask', { id: created.result.task.id }));
  expect(response.headers.get('content-type')).toContain('application/json');
  expect((await json(response)).error.code).toBe(-32004);
});

it('A2A malformed JSON uses the JSON-RPC parse-error envelope', async () => {
  const { post } = await setup();
  const response = await post('/a2a', '{');
  expect(await response.json()).toMatchObject({
    jsonrpc: '2.0',
    id: null,
    error: { code: -32700 },
  });
});

it('A2A invalid envelope uses the JSON-RPC invalid-request envelope', async () => {
  const { post } = await setup();
  const response = await post('/a2a', {
    jsonrpc: '1.0',
    id: 'acceptance',
    method: 'GetTask',
    params: {},
  });
  expect(await response.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32600 } });
});

it('A2A missing required message uses JSON-RPC invalid-params with the request id', async () => {
  const { post } = await setup();
  expect(await (await post('/a2a', rpc('SendMessage'))).json()).toMatchObject({
    jsonrpc: '2.0',
    id: 'acceptance',
    error: { code: -32602 },
  });
});

it('A2A unknown methods return JSON-RPC MethodNotFound', async () => {
  const { post } = await setup();
  expect(await (await post('/a2a', rpc('NonexistentMethod'))).json()).toMatchObject({
    jsonrpc: '2.0',
    id: 'acceptance',
    error: { code: -32601 },
  });
});

it.each([
  'CreateTaskPushNotificationConfig',
  'GetTaskPushNotificationConfig',
  'ListTaskPushNotificationConfigs',
  'DeleteTaskPushNotificationConfig',
])('A2A disabled push notifications use PushNotificationNotSupportedError: %s', async (method) => {
  const { post } = await setup();
  const response = await post(
    '/a2a',
    rpc(method, { taskId: 'task', id: 'config', url: 'https://example.invalid/callback' }),
  );
  expect((await json(response)).error.code).toBe(-32003);
});

it('A2A rejects a malformed taskId without coercing it and starting execution', async () => {
  const execute = vi.fn(() => 'hello');
  const { post } = await setup(execute);
  const response = await post('/a2a', rpc('SendMessage', { message: message({ taskId: false }) }));
  const body = await json(response);
  expect(execute).not.toHaveBeenCalled();
  expect(body.error).toBeDefined();
});

it('A2A interface routing tenant is independent from the authenticated storage tenant', async () => {
  const { post } = await setup(() => 'hello', 'public-route');
  const response = await post(
    '/a2a',
    rpc('SendMessage', { tenant: 'public-route', message: message() }),
  );
  expect(response.status).toBe(200);
  expect((await json(response)).result.task.status.state).toBe('TASK_STATE_COMPLETED');
});

it('A2A supports ListTasks for an authenticated caller', async () => {
  const { post } = await setup();
  const created = await json(await post('/a2a', rpc('SendMessage', { message: message() })));
  const body = await json(await post('/a2a', rpc('ListTasks')));
  expect(body.error).toBeUndefined();
  expect(body.result.tasks).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: created.result.task.id })]),
  );
  expect(body.result.nextPageToken).toBe('');
});

it('AGUI closes an empty successful run without inventing text', async () => {
  const { post } = await setup(() => undefined);
  const stream = await events(await post('/ag-ui', input()));
  expect(stream.map((event) => event.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
});

it('AGUI reports a cooperatively timed-out run as cancelled, not successful', async () => {
  const { post } = await setup(
    async (_input, context) => {
      await new Promise<void>((resolve) =>
        context.signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    },
    undefined,
    { executionLimits: { executionTimeoutMs: 20 } },
  );
  const stream = await events(await post('/ag-ui', input()));
  expect(stream.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'cancelled' } });
  expect(stream.at(-1)).not.toHaveProperty('result');
});

it('A2A unknown tasks return TaskNotFound without leaking other data', async () => {
  const { post } = await setup();
  expect(await json(await post('/a2a', rpc('GetTask', { id: 'missing' })))).toMatchObject({
    jsonrpc: '2.0',
    id: 'acceptance',
    error: { code: -32001 },
  });
});

it('A2A preserves an accepted client contextId in the response', async () => {
  const { post } = await setup();
  const body = await json(
    await post('/a2a', rpc('SendMessage', { message: message({ contextId: 'client-context' }) })),
  );
  expect(body.result.task.contextId).toBe('client-context');
});

it('A2A failed streaming executions end with a failed task state and no private error', async () => {
  const { post } = await setup(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw new Error('private-provider-secret');
  });
  const response = await post('/a2a', rpc('SendStreamingMessage', { message: message() }));
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const stream = (await response.text())
    .split('\n\n')
    .filter((frame) => frame.startsWith('data:'))
    .map((frame) => JSON.parse(frame.slice(5).trim()));
  expect(stream[0].result.task).toBeDefined();
  expect(stream.at(-1).result.statusUpdate.status.state).toBe('TASK_STATE_FAILED');
  expect(JSON.stringify(stream)).not.toContain('private-provider-secret');
});

it('AGUI strips nested protocol extras but preserves open metadata and normalizes text in order', async () => {
  const execute = vi.fn((_input: unknown) => 'hello');
  const { post } = await setup(execute);
  const metadata = { applicationSpecific: { custom: 7 } };
  await events(
    await post(
      '/ag-ui',
      input({
        messages: [
          {
            id: 'm',
            role: 'user',
            extraMessageField: 'drop',
            metadata,
            content: [
              { type: 'text', text: 'one', futurePartField: 1 },
              { type: 'text', text: 'two' },
            ],
          },
        ],
        context: [{ description: 'context', value: 'value', futureContextField: 1 }],
      }),
    ),
  );
  const received = execute.mock.calls[0]![0] as any;
  expect(received.messages[0]).toMatchObject({ content: 'onetwo', metadata });
  expect(received.messages[0]).not.toHaveProperty('extraMessageField');
  expect(received.context[0]).not.toHaveProperty('futureContextField');
});

it('AGUI drops future message/part/source variants and never forwards unusable URLs', async () => {
  const execute = vi.fn((_input: unknown) => 'hello');
  const { post } = await setup(execute);
  await events(
    await post(
      '/ag-ui',
      input({
        messages: [
          { id: 'future', role: 'future-role', content: { opaque: true } },
          {
            id: 'm',
            role: 'user',
            content: [
              { type: 'future-part', arbitrary: true },
              { type: 'image', source: { type: 'future-source', opaque: true } },
              { type: 'image', source: { type: 'url', value: 'http://127.0.0.1/private' } },
              { type: 'text', text: 'usable' },
            ],
          },
        ],
      }),
    ),
  );
  const received = execute.mock.calls[0]![0] as any;
  expect(received.messages).toHaveLength(1);
  expect(received.messages[0].content).toBe('usable');
  expect(JSON.stringify(received)).not.toContain('127.0.0.1');
});

it.each([
  [{ type: 'text', text: 123 }],
  [{ type: 'image', source: { type: 'url', value: 123 } }],
  [{ type: 'image', source: { type: 'file', value: 'provider-id', provider: 123 } }],
])('AGUI does not repair malformed known content when skipping media: %j', async (content) => {
  const execute = vi.fn(() => 'hello');
  const { post } = await setup(execute);
  const response = await post('/ag-ui', input({ messages: [{ id: 'm', role: 'user', content }] }));
  expect(response.status).toBe(400);
  expect(execute).not.toHaveBeenCalled();
});

it('AGUI accepts an assistant history entry with omitted optional text', async () => {
  const { post } = await setup();
  await events(
    await post(
      '/ag-ui',
      input({
        messages: [
          { id: 'a', role: 'assistant' },
          { id: 'u', role: 'user', content: 'hello' },
        ],
      }),
    ),
  );
});

it.each(['1.10', 'future-version'])(
  'AGUI remains compatible with peer version %s',
  async (protocolVersion) => {
    const { post } = await setup();
    const stream = await events(await post('/ag-ui', input({ protocolVersion })));
    expect(stream[0].protocolVersion).toBe('1.0');
  },
);

it('AGUI rejects an unsupported major before starting execution', async () => {
  const execute = vi.fn(() => 'hello');
  const { post } = await setup(execute);
  expect((await post('/ag-ui', input({ protocolVersion: '2.0' }))).status).toBe(400);
  expect(execute).not.toHaveBeenCalled();
});

it('A2A ListTasks paginates without duplicates, filters, and omits artifacts by default', async () => {
  const { post } = await setup();
  const ids = [];
  for (let i = 0; i < 4; i++) {
    const created = await json(
      await post(
        '/a2a',
        rpc('SendMessage', {
          message: message({ messageId: `m-${i}`, contextId: i === 3 ? 'other' : 'context' }),
        }),
      ),
    );
    ids.push(created.result.task.id);
  }
  const filters = { contextId: 'context', status: 'TASK_STATE_COMPLETED', historyLength: 0 };
  const page1 = await json(await post('/a2a', rpc('ListTasks', { ...filters, pageSize: 1 })));
  expect(page1.result).toMatchObject({ totalSize: 3, pageSize: 1 });
  expect(page1.result.nextPageToken).not.toBe('');
  expect(page1.result.tasks[0]).not.toHaveProperty('artifacts');
  expect(page1.result.tasks[0].history ?? []).toHaveLength(0);
  const page2 = await json(
    await post(
      '/a2a',
      rpc('ListTasks', { ...filters, pageSize: 2, pageToken: page1.result.nextPageToken }),
    ),
  );
  expect(page2.result.nextPageToken).toBe('');
  const returned = [...page1.result.tasks, ...page2.result.tasks];
  expect(new Set(returned.map((t) => t.id)).size).toBe(3);
  expect(returned.map((t) => t.id).sort()).toEqual(ids.slice(0, 3).sort());
  const timestamps = returned.map((t) => Date.parse(t.status.timestamp));
  expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  const withArtifacts = await json(
    await post('/a2a', rpc('ListTasks', { includeArtifacts: true })),
  );
  expect(
    withArtifacts.result.tasks.every((t: any) => t.artifacts[0].parts[0].text === 'hello'),
  ).toBe(true);
  const future = await json(
    await post('/a2a', rpc('ListTasks', { statusTimestampAfter: '9999-01-01T00:00:00Z' })),
  );
  expect(future.result).toMatchObject({ tasks: [], totalSize: 0, nextPageToken: '' });
});

it.each(['other-user', 'other-tenant'])('A2A list and page tokens isolate %s', async (token) => {
  const { post } = await setup();
  for (const id of ['one', 'two'])
    await json(await post('/a2a', rpc('SendMessage', { message: message({ messageId: id }) })));
  const own = await json(await post('/a2a', rpc('ListTasks', { pageSize: 1 })));
  const foreign = await json(await post('/a2a', rpc('ListTasks'), token));
  expect(foreign.result).toMatchObject({ tasks: [], totalSize: 0 });
  const cursor = await post(
    '/a2a',
    rpc('ListTasks', { pageToken: own.result.nextPageToken }),
    token,
  );
  expect(cursor.status).toBe(400);
  expect((await json(cursor)).error.code).toBe(-32602);
});

it('A2A rejects tampered or filter-swapped page tokens', async () => {
  const { post } = await setup();
  for (const id of ['one', 'two'])
    await json(await post('/a2a', rpc('SendMessage', { message: message({ messageId: id }) })));
  const own = await json(await post('/a2a', rpc('ListTasks', { pageSize: 1 })));
  const pageToken = own.result.nextPageToken;
  for (const params of [
    { pageToken: 'garbage' },
    { pageToken: pageToken.slice(0, -3) },
    { pageToken, contextId: 'new-filter' },
  ]) {
    const response = await post('/a2a', rpc('ListTasks', params));
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe(-32602);
  }
});

it('A2A task listing excludes expired records and records from other protocols', async () => {
  const { post, app } = await setup(() => 'hello', undefined, {
    executionLimits: { retentionMs: 10 },
  });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  await json(await post('/a2a', rpc('SendMessage', { message: message() })));
  await app.executions.start(
    { tenantId: 'verified-tenant', subject: 'user' },
    'unrelated-protocol',
    {},
    () => 'private',
  ).done;
  const current = await json(await post('/a2a', rpc('ListTasks')));
  expect(current.result.tasks).toHaveLength(1);
  clock.mockReturnValue(now + 11);
  const expired = await json(await post('/a2a', rpc('ListTasks')));
  expect(expired.result).toMatchObject({ tasks: [], totalSize: 0 });
});

it.each([
  { pageSize: 0 },
  { pageSize: 101 },
  { pageSize: '1' },
  { pageSize: 1.5 },
  { includeArtifacts: 'false' },
  { status: 'NOT_A_STATE' },
  { status: 999 },
  { historyLength: -1 },
  { contextId: 123 },
  { pageToken: 123 },
  { statusTimestampAfter: '2026-02-30T00:00:00Z' },
  { statusTimestampAfter: 'tomorrow' },
])(
  'A2A validates raw list parameters before the protobuf codec coerces them: %j',
  async (params) => {
    const { post } = await setup();
    const response = await post('/a2a', rpc('ListTasks', params));
    expect(response.status).toBe(400);
    expect((await json(response)).error.code).toBe(-32602);
  },
);

it.each(['GetTask', 'CancelTask', 'SubscribeToTask'])(
  'A2A %s validates identifiers using JSON-RPC errors',
  async (method) => {
    const { post } = await setup();
    const response = await post('/a2a', rpc(method, { id: 123 }));
    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      jsonrpc: '2.0',
      id: 'acceptance',
      error: { code: -32602 },
    });
  },
);

it('A2A accepts omitted params for a parameterless operation and returns its semantic error', async () => {
  const { post } = await setup();
  expect(
    await json(
      await post('/a2a', { jsonrpc: '2.0', id: 'no-params', method: 'GetExtendedAgentCard' }),
    ),
  ).toMatchObject({
    jsonrpc: '2.0',
    id: 'no-params',
    error: { code: -32004 },
  });
});

it('A2A separates unsupported push and media errors from malformed parameters', async () => {
  const { post } = await setup();
  for (const [configuration, code] of [
    [{ taskPushNotificationConfig: { url: 'https://example.invalid/callback' } }, -32003],
    [{ acceptedOutputModes: ['application/json'] }, -32005],
  ] as const) {
    const response = await post('/a2a', rpc('SendMessage', { message: message(), configuration }));
    expect((await json(response)).error.code).toBe(code);
  }
});

it('A2A requires the advertised route without trusting it as an authentication identity', async () => {
  const { post } = await setup(() => 'hello', 'public-route');
  for (const tenant of [undefined, '', 'verified-tenant', 'wrong']) {
    const response = await post('/a2a', rpc('SendMessage', { tenant, message: message() }));
    expect(response.status).toBe(403);
  }
  const created = await json(
    await post('/a2a', rpc('SendMessage', { tenant: 'public-route', message: message() })),
  );
  const foreign = await json(
    await post(
      '/a2a',
      rpc('GetTask', { tenant: 'public-route', id: created.result.task.id }),
      'other-user',
    ),
  );
  expect(foreign.error.code).toBe(-32001);
});

it.each([
  { page_size: 0 },
  { page_size: '1' },
  { history_length: -1 },
  { include_artifacts: 'false' },
  { context_id: 123 },
  { page_token: 123 },
  { status_timestamp_after: 'tomorrow' },
  { page_size: 1, pageSize: 2 },
])('A2A validates ProtoJSON aliases and rejects duplicate spellings: %j', async (params) => {
  const { post } = await setup();
  const response = await post('/a2a', rpc('ListTasks', params));
  expect(response.status).toBe(400);
  expect((await json(response)).error.code).toBe(-32602);
});

it('A2A supports valid ProtoJSON spellings consistently for send, get and list', async () => {
  const { post } = await setup();
  const created = await json(
    await post(
      '/a2a',
      rpc('SendMessage', {
        message: {
          message_id: 'alias',
          role: 'ROLE_USER',
          context_id: 'ctx',
          parts: [{ text: 'hi', media_type: 'text/plain' }],
        },
        configuration: { history_length: 0, return_immediately: false },
      }),
    ),
  );
  expect(created.result.task.history ?? []).toHaveLength(0);
  const fetched = await json(
    await post('/a2a', rpc('GetTask', { id: created.result.task.id, history_length: 0 })),
  );
  expect(fetched.result.history ?? []).toHaveLength(0);
  const listed = await json(
    await post(
      '/a2a',
      rpc('ListTasks', { context_id: 'ctx', page_size: 1, include_artifacts: true }),
    ),
  );
  expect(listed.result.tasks[0].id).toBe(created.result.task.id);
  expect(listed.result.tasks[0].artifacts).toHaveLength(1);
});

it.each([
  { message: message(), configuration: { return_immediately: 'false' } },
  { message: message(), configuration: { history_length: -1 } },
  { message: message({ task_id: false }) },
  { message: message({ reference_task_ids: [123] }) },
])('A2A malformed send aliases cannot start execution: %j', async (params) => {
  const execute = vi.fn(() => 'hello');
  const { post } = await setup(execute);
  const response = await post('/a2a', rpc('SendMessage', params));
  expect(response.status).toBe(400);
  expect((await json(response)).error.code).toBe(-32602);
  expect(execute).not.toHaveBeenCalled();
});

it.each([null, '', 0])('A2A preserves valid JSON-RPC request id %j', async (id) => {
  const { post } = await setup();
  const body = await json(await post('/a2a', { ...rpc('GetTask', { id: 'missing' }), id }));
  expect(body).toMatchObject({ jsonrpc: '2.0', id, error: { code: -32001 } });
});

it('official A2A client discovers and invokes a routing tenant with a different verified tenant', async () => {
  const { url } = await setup(() => 'hello', 'public-route');
  const fetchImpl: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', 'Bearer local-test');
    return fetch(url, { ...init, headers });
  };
  const client = await new a2aClient.ClientFactory({
    transports: [new a2aClient.JsonRpcTransportFactory({ fetchImpl })],
    cardResolver: new a2aClient.DefaultAgentCardResolver({ fetchImpl }),
    clientConfig: { polling: false },
  }).createFromUrl(url);
  const task = await client.sendMessage(
    a2aModels.SendMessageRequest.fromJSON({ message: message() }),
  );
  const list = await client.listTasks(
    a2aModels.ListTasksRequest.fromJSON({ includeArtifacts: true }),
  );
  expect(list.tasks[0]?.id).toBe(task.id);
  expect(list.tasks[0]?.artifacts[0]?.parts[0]?.content?.value).toBe('hello');
});

it('official AGUI HttpAgent can send a text ContentPart array', async () => {
  const { url } = await setup();
  const agent = new aguiClient.HttpAgent({
    url: url + '/ag-ui',
    headers: { authorization: 'Bearer local-test' },
    threadId: 'official-parts',
    messages: [{ id: 'u', role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });
  await agent.runAgent({ runId: 'official-parts' });
  expect(
    agent.messages.some(
      (message: any) => message.role === 'assistant' && message.content === 'hello',
    ),
  ).toBe(true);
});

it('AGUI bounds compatibility warnings and does not log stripped values', async () => {
  const { post, app } = await setup();
  const warned = vi.spyOn(app.logger, 'warn').mockImplementation(() => {});
  const extras = Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`future-${i}`, 'private-value']),
  );
  await events(await post('/ag-ui', input(extras)));
  expect(warned.mock.calls.length).toBeGreaterThan(0);
  expect(warned.mock.calls.length).toBeLessThanOrEqual(9);
  expect(JSON.stringify(warned.mock.calls)).not.toContain('private-value');
});

it('A2A statusTimestampAfter is inclusive and preserves a finer-than-millisecond cutoff', async () => {
  const { post } = await setup();
  const created = await json(await post('/a2a', rpc('SendMessage', { message: message() })));
  const timestamp = created.result.task.status.timestamp;
  const inclusive = await json(
    await post('/a2a', rpc('ListTasks', { statusTimestampAfter: timestamp })),
  );
  expect(inclusive.result.tasks).toHaveLength(1);
  const after = timestamp.replace(/(\.\d{3})Z$/, '$1000001Z');
  const exclusive = await json(
    await post('/a2a', rpc('ListTasks', { statusTimestampAfter: after })),
  );
  expect(exclusive.result.tasks).toHaveLength(0);
});

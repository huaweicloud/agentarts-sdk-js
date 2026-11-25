import { afterEach, afterAll, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { AgentArtsRuntimeApp, type ProtocolStorage } from 'agentarts-sdk/sdk/runtime';
import {
  createAguiAgent,
  type AguiAgentOptions,
} from '../../packages/agentarts-protocol-agui/src/agent.js';
import {
  createA2aService,
  type A2aServiceOptions,
} from '../../packages/agentarts-protocol-a2a/src/service.js';
const a2areq = createRequire(
  new URL('../../packages/agentarts-protocol-a2a/package.json', import.meta.url),
);
const aguireq = createRequire(
  new URL('../../packages/agentarts-protocol-agui/package.json', import.meta.url),
);
const sdk = await import(a2areq.resolve('@a2a-js/sdk'));
const grpc = await import(a2areq.resolve('@grpc/grpc-js'));
const grpcModel = await import(a2areq.resolve('@a2a-js/sdk/server/grpc'));
const agui = await import(aguireq.resolve('@ag-ui/core'));
const aguiClient = await import(aguireq.resolve('@ag-ui/client'));
const E = agui.EventType;
const cleanup: Array<() => Promise<unknown>> = [];
const aguiInputs = new WeakMap<globalThis.Response, unknown>();
const captured: Array<{ input: unknown; events: unknown[] }> = [];
afterAll(async () => {
  if (process.env.AGENTARTS_REVIEW_CAPTURE)
    await writeFile(process.env.AGENTARTS_REVIEW_CAPTURE, JSON.stringify(captured));
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const authenticate = ({ headers }: { headers: Readonly<Record<string, unknown>> }) =>
  headers.authorization === 'Bearer alice'
    ? { tenantId: 'tenant', subject: 'alice' }
    : headers.authorization === 'Bearer bob'
      ? { tenantId: 'tenant', subject: 'bob' }
      : null;
async function post(
  url: string,
  body: unknown,
  token = 'alice',
  headers: Record<string, string> = {},
) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'a2a-version': '1.0',
      ...headers,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (url.endsWith('/ag-ui')) aguiInputs.set(response, body);
  return response;
}
function rpc(method: string, params: unknown) {
  return { jsonrpc: '2.0', id: 'full', method, params };
}
async function json(response: globalThis.Response): Promise<any> {
  return response.json();
}
async function frames(response: globalThis.Response): Promise<any[]> {
  expect(response.status).toBe(200);
  const events = (await response.text())
    .split('\n\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5).trim()));
  if (aguiInputs.has(response)) captured.push({ input: aguiInputs.get(response), events });
  return events;
}
const input = (runId: string, extra: Record<string, unknown> = {}) => ({
  threadId: 'thread',
  runId,
  messages: [{ id: 'u', role: 'user', content: 'hello' }],
  ...extra,
});
async function aguiServer(execute: AguiAgentOptions['execute'], storage?: ProtocolStorage) {
  const app = new AgentArtsRuntimeApp();
  app.use(createAguiAgent({ authenticate, execute, storage }));
  const server = app.run('127.0.0.1', 0);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ag-ui`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await app.shutdown();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanup.push(close);
  return { url, app, close };
}
async function a2aServer(
  execute: A2aServiceOptions['execute'],
  extra: Partial<A2aServiceOptions> = {},
  grpcUrl?: string,
  configureCard?: (card: A2aServiceOptions['agentCard']) => void,
) {
  const runtime = extra.runtime ?? new AgentArtsRuntimeApp();
  let listener: ReturnType<typeof createA2aService>['http'];
  const server = createServer((req, res) => listener(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const agentCard = sdk.AgentCard.fromJSON({
    name: 'Full test',
    description: 'test',
    version: '1.0',
    supportedInterfaces: [
      { url: url + '/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: url + '/a2a/rest', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
      ...(grpcUrl ? [{ url: grpcUrl, protocolBinding: 'GRPC', protocolVersion: '1.0' }] : []),
    ],
    defaultInputModes: ['text/plain', 'image/png', 'application/json', 'application/octet-stream'],
    defaultOutputModes: ['text/plain', 'application/json', 'application/pdf'],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    skills: [],
  });
  configureCard?.(agentCard);
  const service = createA2aService({ runtime, agentCard, authenticate, execute, ...extra });
  listener = service.http;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await service.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  cleanup.push(close);
  return { runtime, service, url, close };
}
function message(id = 'm', extra: Record<string, unknown> = {}) {
  return { messageId: id, role: 'ROLE_USER', parts: [{ text: 'hello' }], ...extra };
}

it('review: AGUI multimodal tool results, reasoning chunks and handled child errors are usable', async () => {
  const { url } = await aguiServer((_input, context) => {
    const id = context.callTool('screenshot', {});
    context.toolResult(id, [
      { type: 'image', source: { type: 'url', value: 'https://example.invalid/screenshot.png' } },
    ]);
    context.emit({ type: E.REASONING_START, messageId: 'analysis' });
    context.emit({ type: E.REASONING_MESSAGE_CHUNK, messageId: 'analysis', delta: 'reasoning' });
    context.emit({ type: E.REASONING_END, messageId: 'analysis' });
    context.emit({
      type: E.SUBAGENT_STARTED,
      subagentRunId: 'failed-child',
      name: 'optional-worker',
    });
    context.emit({
      type: E.SUBAGENT_ERROR,
      subagentRunId: 'failed-child',
      message: 'Optional child unavailable',
    });
    context.emitText('parent recovered');
  });
  const events = await frames(
    await post(
      url,
      input('additional-events', {
        tools: [{ name: 'screenshot', description: 'screenshot', parameters: {} }],
      }),
    ),
  );
  expect(events.at(-1).type).toBe('RUN_FINISHED');
  expect(
    events.some((event) => event.type === 'TOOL_CALL_RESULT' && event.content[0].type === 'image'),
  ).toBe(true);
  expect(events.some((event) => event.type === 'SUBAGENT_ERROR')).toBe(true);
});

it('review: A2A continuation can negotiate text after a prior PDF artifact', async () => {
  const { url } = await a2aServer((_message, context) =>
    context.checkpoint
      ? 'approved'
      : {
          state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED,
          checkpoint: { approval: true },
          artifacts: [
            sdk.Artifact.fromJSON({
              artifactId: 'pdf',
              parts: [{ raw: 'UERG', mediaType: 'application/pdf' }],
            }),
          ],
        },
  );
  const first = await json(
    await post(
      url + '/a2a',
      rpc('SendMessage', {
        message: message('pdf'),
        configuration: { acceptedOutputModes: ['application/pdf'] },
      }),
    ),
  );
  expect(first.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
  const second = await json(
    await post(
      url + '/a2a',
      rpc('SendMessage', {
        message: message('text', { taskId: first.result.task.id }),
        configuration: { acceptedOutputModes: ['text/plain'] },
      }),
    ),
  );
  expect(second.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  expect(
    second.result.task.artifacts.some((artifact: any) =>
      artifact.parts.some((part: any) => part.text === 'approved'),
    ),
  ).toBe(true);
});

it('review: REST streaming continuation does not republish unchanged prior artifacts', async () => {
  const { url } = await a2aServer((_message, context) =>
    context.checkpoint
      ? 'approved'
      : {
          state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED,
          checkpoint: { approval: true },
          artifacts: [
            sdk.Artifact.fromJSON({
              artifactId: 'historical-pdf',
              parts: [{ raw: 'UERG', mediaType: 'application/pdf' }],
            }),
          ],
        },
  );
  const first = await json(await post(url + '/a2a/rest/message:send', { message: message('pdf') }));
  const events = await frames(
    await post(url + '/a2a/rest/message:stream', {
      message: message('text', { taskId: first.task.id }),
      configuration: { acceptedOutputModes: ['text/plain'] },
    }),
  );
  expect(events[0].task.artifacts[0].artifactId).toBe('historical-pdf');
  expect(
    events
      .filter((event) => event.artifactUpdate)
      .map((event) => event.artifactUpdate.artifact.parts[0].text),
  ).toEqual(['approved']);
  expect(events.at(-1).statusUpdate.status.state).toBe('TASK_STATE_COMPLETED');
});

it('review: REST cancel accepts a valid empty chunked request body', async () => {
  const { url } = await a2aServer(() => ({ state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED }));
  const first = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  const { request } = await import('node:http');
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const requestHandle = request(
      `${url}/a2a/rest/tasks/${first.result.task.id}:cancel`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer alice',
          'a2a-version': '1.0',
          'content-type': 'application/json',
          'transfer-encoding': 'chunked',
        },
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode!, body }));
      },
    );
    requestHandle.on('error', reject);
    requestHandle.end();
  });
  expect(response.status).toBe(200);
  expect(JSON.parse(response.body).status.state).toBe('TASK_STATE_CANCELED');
});

it('review: malformed extended cards are rejected rather than returned as a successful discovery response', async () => {
  const { url } = await a2aServer(() => 'ok', {
    extendedAgentCard: async () =>
      sdk.AgentCard.fromJSON({
        name: 'Extended',
        version: '1.0',
        defaultInputModes: ['text/plain'],
        defaultOutputModes: ['text/plain'],
      }),
  });
  const result = await json(await post(url + '/a2a', rpc('GetExtendedAgentCard', {})));
  expect(result.error).toBeDefined();
});

it('review: AGUI attributed state, encrypted reasoning and nested subagents remain usable', async () => {
  const { url } = await aguiServer((_input, context) => {
    context.emit({ type: E.SUBAGENT_STARTED, subagentRunId: 'outer', name: 'outer' });
    context.emit({
      type: E.SUBAGENT_STARTED,
      subagentRunId: 'inner',
      parentSubagentRunId: 'outer',
      name: 'inner',
    });
    context.emit({ type: E.STATE_SNAPSHOT, subagentRunId: 'inner', snapshot: { done: 1 } });
    context.emit({
      type: E.STATE_DELTA,
      subagentRunId: 'inner',
      delta: [{ op: 'replace', path: '/done', value: 2 }],
    });
    context.emit({ type: E.REASONING_START, messageId: 'reason', subagentRunId: 'inner' });
    context.emit({
      type: E.REASONING_ENCRYPTED_VALUE,
      entityId: 'reason',
      subtype: 'message',
      encryptedValue: 'opaque-value',
      subagentRunId: 'inner',
    });
    context.emit({ type: E.REASONING_END, messageId: 'reason', subagentRunId: 'inner' });
    context.emit({ type: E.SUBAGENT_FINISHED, subagentRunId: 'inner' });
    context.emit({ type: E.SUBAGENT_FINISHED, subagentRunId: 'outer' });
    expect(context.state).toEqual({ done: 2 });
  });
  const events = await frames(await post(url, input('nested')));
  expect(events.at(-1).type).toBe('RUN_FINISHED');
});

it('review: expired AGUI interrupts can be explicitly cancelled and unknown answers are ignored', async () => {
  const execute = vi.fn((_input, context) => {
    if (!context.checkpoint)
      return context.interrupt(
        [{ id: 'expired', reason: 'approval', expiresAt: '2000-01-01T00:00:00Z' }],
        { saved: true },
      );
    expect(context.resume).toEqual([{ interruptId: 'expired', status: 'cancelled' }]);
    context.emitText('cancel acknowledged');
  });
  const { url } = await aguiServer(execute);
  await frames(await post(url, input('pause')));
  expect(
    (
      await post(
        url,
        input('invalid', {
          resume: [{ interruptId: 'expired', status: 'resolved', payload: true }],
        }),
      )
    ).status,
  ).toBe(400);
  const resumed = await frames(
    await post(
      url,
      input('cancel', {
        resume: [
          { interruptId: 'expired', status: 'cancelled' },
          { interruptId: 'unknown', status: 'cancelled' },
        ],
      }),
    ),
  );
  expect(resumed.at(-1).type).toBe('RUN_FINISHED');
  expect(execute).toHaveBeenCalledTimes(2);
});

it('review: failed resumed run retains the approval gate and can recover with explicit answers', async () => {
  let count = 0;
  const { url } = await aguiServer((_input, context) => {
    if (++count === 1)
      return context.interrupt([{ id: 'once', reason: 'approval' }], { saved: true });
    if (count === 2) throw new Error('downstream failed after consuming approval');
    context.emitText('recovered');
  });
  await frames(await post(url, input('pause')));
  expect(
    (
      await frames(
        await post(
          url,
          input('resume', { resume: [{ interruptId: 'once', status: 'resolved', payload: true }] }),
        ),
      )
    ).at(-1).type,
  ).toBe('RUN_ERROR');
  const recovery = await post(url, input('ordinary-new-run'));
  expect(recovery.status).toBe(400);
  const retried = await post(
    url,
    input('explicit-recovery', {
      resume: [{ interruptId: 'once', status: 'resolved', payload: true }],
    }),
  );
  expect((await frames(retried)).at(-1).type).toBe('RUN_FINISHED');
});

it('review: official AGUI client accepts replay of a run with pending frontend tools', async () => {
  const { url } = await aguiServer((_input, context) => {
    const id = context.callTool('lookup', { query: 'hello' });
    return { outcome: { type: 'success', pendingToolCallIds: [id] } };
  });
  const makeClient = () =>
    new aguiClient.HttpAgent({
      url,
      headers: { authorization: 'Bearer alice' },
      threadId: 'tools-replay',
      messages: [{ id: 'u', role: 'user', content: 'hello' }],
    });
  const config = {
    runId: 'same',
    tools: [{ name: 'lookup', description: 'lookup', parameters: {} }],
  };
  const first = makeClient();
  await first.runAgent(config);
  const second = makeClient();
  await second.runAgent(config);
  expect(
    second.messages.some((item: any) => item.role === 'assistant' && item.toolCalls?.length),
  ).toBe(true);
});

it('review: every configured webhook gets a delivery attempt when another receiver is slow', async () => {
  const seen: string[] = [];
  const responses: import('node:http').ServerResponse[] = [];
  let arrived!: () => void;
  const firstArrival = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const receiver = createServer((req, res) => {
    seen.push(req.url!);
    responses.push(res);
    req.resume();
    arrived();
    setTimeout(() => res.end('ok'), req.url === '/one' ? 60 : 0);
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  cleanup.push(async () => {
    for (const response of responses) if (!response.writableEnded) response.end('ok');
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });
  const origin = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  const { url, service } = await a2aServer(
    async (_message, context) => {
      if (!context.checkpoint)
        return { state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED, checkpoint: { saved: true } };
      await firstArrival;
      return 'done';
    },
    {
      push: {
        allowedOrigins: [origin],
        allowLoopbackForTesting: true,
        maxPending: 1,
        timeoutMs: 1000,
      },
    },
  );
  const first = await json(
    await post(url + '/a2a', rpc('SendMessage', { message: message('initial') })),
  );
  const taskId = first.result.task.id;
  for (const id of ['one', 'two'])
    await post(
      url + '/a2a',
      rpc('CreateTaskPushNotificationConfig', { taskId, id, url: `${origin}/${id}` }),
    );
  const second = await json(
    await post(url + '/a2a', rpc('SendMessage', { message: message('resume', { taskId }) })),
  );
  expect(second.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  for (const response of responses) response.end('ok');
  await service.close();
  expect(seen).toContain('/one');
  expect(seen).toContain('/two');
});

it('review: AGUI child suspension and root interrupt can resume without losing attribution', async () => {
  const { url } = await aguiServer((_input, context) => {
    if (!context.checkpoint) {
      context.emit({ type: E.SUBAGENT_STARTED, subagentRunId: 'worker', name: 'worker' });
      context.emit({
        type: E.SUBAGENT_FINISHED,
        subagentRunId: 'worker',
        outcome: { type: 'suspended', interruptIds: ['child-approval'] },
      });
      return context.interrupt(
        [{ id: 'child-approval', reason: 'approval', subagentRunId: 'worker' }],
        { child: true },
      );
    }
    expect(context.resume[0]?.interruptId).toBe('child-approval');
    context.emitText('child approved');
  });
  const pause = await frames(await post(url, input('child-pause')));
  expect(pause.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    outcome: { type: 'interrupt', interrupts: [{ subagentRunId: 'worker' }] },
  });
  const resumed = await frames(
    await post(
      url,
      input('child-resume', {
        resume: [{ interruptId: 'child-approval', status: 'resolved', payload: true }],
      }),
    ),
  );
  expect(resumed.at(-1).type).toBe('RUN_FINISHED');
});

it('review: A2A hands off only after final delivery and notifies cancellation of a paused task', async () => {
  let unblock!: () => void;
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const states: string[] = [];
  const receiver = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const state = JSON.parse(Buffer.concat(chunks).toString()).statusUpdate?.status?.state;
    if (state) states.push(state);
    if (state === 'TASK_STATE_INPUT_REQUIRED' && states.length === 1) {
      arrive();
      await blocked;
    }
    res.end('ok');
  });
  receiver.listen(0, '127.0.0.1');
  await once(receiver, 'listening');
  cleanup.push(async () => {
    unblock();
    receiver.closeAllConnections();
    await new Promise<void>((resolve) => receiver.close(() => resolve()));
  });
  const origin = 'http://127.0.0.1:' + (receiver.address() as AddressInfo).port;
  const execute = vi.fn(() => ({ state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED }));
  const { url } = await a2aServer(execute, {
    push: { allowedOrigins: [origin], allowLoopbackForTesting: true, timeoutMs: 2000 },
  });
  const call = async (method: string, params: unknown) =>
    json(await post(url + '/a2a', rpc(method, params)));
  const sent = await call('SendMessage', {
    message: message('start'),
    configuration: {
      returnImmediately: true,
      taskPushNotificationConfig: { url: origin + '/notify' },
    },
  });
  const id = sent.result.task.id;
  await arrived;
  try {
    expect(
      (await call('SendMessage', { message: message('early', { taskId: id }) })).error,
    ).toBeDefined();
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    unblock();
  }
  await call('SendMessage', { message: message('start') });
  const resumed = await call('SendMessage', { message: message('resume', { taskId: id }) });
  expect(resumed.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
  const canceled = await call('CancelTask', { id });
  expect(canceled.result.status.state).toBe('TASK_STATE_CANCELED');
  expect(states).toEqual([
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_CANCELED',
  ]);
});

it('review: AGUI oversized terminal event never commits success and failure replays consistently', async () => {
  const { MemoryProtocolStorage } = await import('agentarts-sdk/sdk/runtime');
  const storage = new MemoryProtocolStorage();
  const writes = vi.spyOn(storage, 'update');
  const execute = vi.fn(() => ({ result: 'x'.repeat(600 * 1024) }));
  const { url } = await aguiServer(execute, storage);
  const body = input('large-terminal');
  expect((await frames(await post(url, body))).at(-1).type).toBe('RUN_ERROR');
  const records = await Promise.all(writes.mock.results.map((item) => item.value));
  expect(
    records.flatMap((record) => (record as any)?.runs ?? []).map((run) => run.status),
  ).not.toContain('finished');
  expect((await frames(await post(url, body))).at(-1).type).toBe('RUN_ERROR');
  expect(execute).toHaveBeenCalledOnce();
});

it.each(['A2A', 'AG-UI'])(
  'review: %s shutdown waits for a blocked claim and skips execution',
  async (protocol) => {
    const { MemoryProtocolStorage } = await import('agentarts-sdk/sdk/runtime');
    const storage = new MemoryProtocolStorage();
    const update = storage.update.bind(storage);
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let scope = '';
    let key = '';
    vi.spyOn(storage, 'update').mockImplementation(async (currentScope, currentKey, change) => {
      if (!key && (protocol === 'AG-UI' || currentKey.startsWith('task:'))) {
        scope = currentScope;
        key = currentKey;
        enter();
        await blocked;
      }
      return update(currentScope, currentKey, change);
    });
    const execute = vi.fn(() => undefined);
    const server =
      protocol === 'A2A'
        ? await a2aServer(execute, { storage })
        : await aguiServer(execute, storage);
    const request =
      protocol === 'A2A'
        ? post(server.url + '/a2a', rpc('SendMessage', { message: message('shutdown') }))
        : post(server.url, input('shutdown'));
    await entered;
    let stopped = false;
    const shutdown = ('service' in server ? server.service.close() : server.app.shutdown()).then(
      () => {
        stopped = true;
      },
    );
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
    } finally {
      release();
    }
    const response = await request;
    if (protocol === 'A2A') {
      expect((await json(response)).result.task.status.state).toBe('TASK_STATE_CANCELED');
    } else {
      expect((await frames(response)).at(-1).outcome.type).toBe('cancelled');
    }
    await shutdown;
    expect(execute).not.toHaveBeenCalled();
    const record = await storage.get<{ owner?: string }>(scope, key);
    expect(record).toBeDefined();
    expect(record?.owner).toBeUndefined();
  },
);

it('review: A2A continuation preserves concurrent push configuration changes', async () => {
  const { MemoryProtocolStorage } = await import('agentarts-sdk/sdk/runtime');
  const storage = new MemoryProtocolStorage();
  const { url } = await a2aServer(() => ({ state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED }), {
    storage,
    push: { allowedOrigins: ['http://127.0.0.1:1'], allowLoopbackForTesting: true, timeoutMs: 50 },
  });
  const call = async (method: string, params: unknown) =>
    json(await post(url + '/a2a', rpc(method, params)));
  const initial = await call('SendMessage', { message: message('initial') });
  const taskId = initial.result.task.id;
  const config = (id: string) => ({ id, taskId, url: 'http://127.0.0.1:1/' + id });
  expect((await call('CreateTaskPushNotificationConfig', config('remove'))).result.id).toBe(
    'remove',
  );

  const update = storage.update.bind(storage);
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(storage, 'update').mockImplementation(async (scope, key, change) => {
    if (key.startsWith('message:')) {
      enter();
      await blocked;
    }
    return update(scope, key, change);
  });
  const continuation = call('SendMessage', {
    message: message('continue', { taskId }),
    configuration: { taskPushNotificationConfig: config('inline') },
  });
  await entered;
  try {
    expect((await call('CreateTaskPushNotificationConfig', config('added'))).result.id).toBe(
      'added',
    );
    const deleted = await call('DeleteTaskPushNotificationConfig', { taskId, id: 'remove' });
    expect(deleted.error).toBeUndefined();
  } finally {
    release();
  }
  expect((await continuation).result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
  const list = await call('ListTaskPushNotificationConfigs', { taskId });
  expect(list.result.configs.map((value: { id: string }) => value.id)).toEqual(['added', 'inline']);
});

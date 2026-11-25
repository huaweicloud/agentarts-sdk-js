import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { AgentArtsRuntimeApp, FileProtocolStorage, MemoryProtocolStorage, ProtocolEventJournal, type ProtocolStorage } from 'agentarts-sdk/sdk/runtime';
import { createAguiAgent, type AguiAgentOptions } from '../../packages/agentarts-protocol-agui/src/agent.js';
import { createA2aService, type A2aServiceOptions } from '../../packages/agentarts-protocol-a2a/src/service.js';
import { A2aPushDispatcher } from '../../packages/agentarts-protocol-a2a/src/push.js';
const a2areq = createRequire(new URL('../../packages/agentarts-protocol-a2a/package.json', import.meta.url));
const aguireq = createRequire(new URL('../../packages/agentarts-protocol-agui/package.json', import.meta.url));
const sdk = await import(a2areq.resolve('@a2a-js/sdk'));
const grpc = await import(a2areq.resolve('@grpc/grpc-js'));
const grpcModel = await import(a2areq.resolve('@a2a-js/sdk/server/grpc'));
const a2aClient = await import(a2areq.resolve('@a2a-js/sdk/client'));
const agui = await import(aguireq.resolve('@ag-ui/core'));
const schemas = await import(aguireq.resolve('@ag-ui/core/schemas'));
const aguiClient = await import(aguireq.resolve('@ag-ui/client'));
const E = agui.EventType;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const authenticate = ({ headers }: { headers: Readonly<Record<string, unknown>> }) => headers.authorization === 'Bearer alice'
  ? { tenantId: 'tenant', subject: 'alice' } : headers.authorization === 'Bearer bob' ? { tenantId: 'tenant', subject: 'bob' } : null;
function post(url: string, body: unknown, token = 'alice', headers: Record<string, string> = {}) {
  return fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'a2a-version': '1.0', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
}
function rpc(method: string, params: unknown) { return { jsonrpc: '2.0', id: 'full', method, params }; }
async function json(response: globalThis.Response): Promise<any> { return response.json(); }
async function frames(response: globalThis.Response): Promise<any[]> {
  expect(response.status).toBe(200);
  return (await response.text()).split('\n\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()));
}
const input = (runId: string, extra: Record<string, unknown> = {}) => ({ threadId: 'thread', runId, messages: [{ id: 'u', role: 'user', content: 'hello' }], ...extra });
async function aguiServer(execute: AguiAgentOptions['execute'], storage?: ProtocolStorage) {
  const app = new AgentArtsRuntimeApp();
  app.use(createAguiAgent({ authenticate, execute, storage }));
  const server = app.run('127.0.0.1', 0); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ag-ui`;
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await app.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  cleanup.push(close); return { url, app, close };
}
async function a2aServer(execute: A2aServiceOptions['execute'], extra: Partial<A2aServiceOptions> = {}, grpcUrl?: string, configureCard?: (card: A2aServiceOptions['agentCard']) => void) {
  const runtime = extra.runtime ?? new AgentArtsRuntimeApp();
  let listener: ReturnType<typeof createA2aService>['http'];
  const server = createServer((req, res) => listener(req, res)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const agentCard = sdk.AgentCard.fromJSON({ name: 'Full test', description: 'test', version: '1.0', supportedInterfaces: [
    { url: url + '/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
    { url: url + '/a2a/rest', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ...(grpcUrl ? [{ url: grpcUrl, protocolBinding: 'GRPC', protocolVersion: '1.0' }] : []),
  ], defaultInputModes: ['text/plain', 'image/png', 'application/json', 'application/octet-stream'], defaultOutputModes: ['text/plain', 'application/json', 'application/pdf'],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } }, securityRequirements: [{ schemes: { bearer: { list: [] } } }], skills: [],
  });
  configureCard?.(agentCard);
  const service = createA2aService({ runtime, agentCard, authenticate, execute, ...extra }); listener = service.http;
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await service.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); };
  cleanup.push(close); return { runtime, service, url, close };
}
function message(id = 'm', extra: Record<string, unknown> = {}) { return { messageId: id, role: 'ROLE_USER', parts: [{ text: 'hello' }], ...extra }; }

it('local encrypted storage persists across instances and serializes atomic updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentarts-full-store-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const key = new Uint8Array(32).fill(7);
  const store = new FileProtocolStorage(directory, { encryptionKey: key });
  await Promise.all(Array.from({ length: 20 }, () => store.update<{ count: number; secret: string }>('scope', 'key', value => ({ count: (value?.count ?? 0) + 1, secret: 'PRIVATE-STATE' }))));
  const reopened = new FileProtocolStorage(directory, { encryptionKey: key });
  expect(await reopened.get('scope', 'key')).toEqual({ count: 20, secret: 'PRIVATE-STATE' });
  expect(await reopened.get('other', 'key')).toBeUndefined();
  for (const file of await readdir(join(directory, 'agentarts-protocol-state'))) expect(await readFile(join(directory, 'agentarts-protocol-state', file), 'utf8')).not.toContain('PRIVATE-STATE');
});

it('event journal fanout is bounded and closing one subscription does not stop other readers', async () => {
  const journal = new ProtocolEventJournal<{ n: number }>(2);
  const one = journal.subscribe(); const two = journal.subscribe();
  journal.publish({ n: 1 }); expect((await one.next()).value).toEqual({ n: 1 });
  await one.return?.(); journal.publish({ n: 2 }); journal.publish({ n: 3 });
  await expect(two.next()).rejects.toMatchObject({ code: 'HISTORY_LOST' });
  const fresh = journal.subscribe(journal.sequence); const pending = fresh.next(); journal.publish({ n: 4 });
  expect((await pending).value).toEqual({ n: 4 }); journal.finish(); await fresh.return?.();
});

it('full AGUI emits verified tools, state, reasoning, activity, subagents, custom and raw events', async () => {
  const { url } = await aguiServer(async (_input, context) => {
    context.emit({ type: E.STATE_SNAPSHOT, snapshot: { count: 1 } });
    context.emit({ type: E.STATE_DELTA, delta: [{ op: 'replace', path: '/count', value: 2 }] });
    const call = context.callTool('lookup', { query: 'hello' }); context.toolResult(call, 'found');
    context.emit({ type: E.STEP_STARTED, stepName: 'analysis' });
    context.emit({ type: E.REASONING_START, messageId: 'reason' });
    context.emit({ type: E.REASONING_MESSAGE_START, messageId: 'reason-message', role: 'reasoning' });
    context.emit({ type: E.REASONING_MESSAGE_CONTENT, messageId: 'reason-message', delta: 'checking' });
    context.emit({ type: E.REASONING_MESSAGE_END, messageId: 'reason-message' });
    context.emit({ type: E.REASONING_END, messageId: 'reason' });
    context.emit({ type: E.ACTIVITY_SNAPSHOT, messageId: 'activity', activityType: 'progress', content: { done: 1 } });
    context.emit({ type: E.ACTIVITY_DELTA, messageId: 'activity', activityType: 'progress', patch: [{ op: 'replace', path: '/done', value: 2 }] });
    context.emit({ type: E.SUBAGENT_STARTED, subagentRunId: 'child', name: 'worker' });
    context.emit({ type: E.TEXT_MESSAGE_START, messageId: 'child-message', role: 'assistant', subagentRunId: 'child' });
    context.emit({ type: E.TEXT_MESSAGE_CONTENT, messageId: 'child-message', delta: 'child output', subagentRunId: 'child' });
    context.emit({ type: E.TEXT_MESSAGE_END, messageId: 'child-message', subagentRunId: 'child' });
    context.emit({ type: E.SUBAGENT_FINISHED, subagentRunId: 'child' });
    context.emit({ type: E.STEP_FINISHED, stepName: 'analysis' });
    context.emit({ type: E.CUSTOM, name: 'business', value: { done: true } });
    context.emit({ type: E.RAW, event: { provider: 'test' } }); context.emitText('complete');
    return { result: { done: true } };
  });
  const events = await frames(await post(url, input('rich', { tools: [{ name: 'lookup', description: 'lookup', parameters: {} }] })));
  for (const event of events) expect(schemas.EventSchema.safeParse(event).success).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'success' }, result: { done: true } });
  expect(events.some(event => event.type === 'SUBAGENT_FINISHED')).toBe(true);
});

it('AGUI interrupt/checkpoint/state survives reopening storage and resumes on a new run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentarts-agui-restart-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const first = await aguiServer((_input, context) => {
    context.emit({ type: E.STATE_SNAPSHOT, snapshot: { stage: 'approval' } });
    return context.interrupt([{ id: 'approve', reason: 'approval', message: 'Continue?' }], { operation: 'purchase', amount: 10 });
  }, new FileProtocolStorage(directory));
  const paused = await frames(await post(first.url, input('pause')));
  expect(paused.at(-1)).toMatchObject({ type: 'RUN_FINISHED', outcome: { type: 'interrupt' } }); await first.close();
  const execute = vi.fn((_input: unknown, context: any) => {
    expect(context.checkpoint).toEqual({ operation: 'purchase', amount: 10 });
    expect(context.state).toEqual({ stage: 'approval' }); expect(context.resume[0].payload).toBe(true);
    context.emitText('approved'); return { result: 'done' };
  });
  const second = await aguiServer(execute, new FileProtocolStorage(directory));
  expect((await post(second.url, input('incomplete'))).status).toBe(400);
  const resumed = await frames(await post(second.url, input('resume', { resume: [{ interruptId: 'approve', status: 'resolved', payload: true }] })));
  expect(resumed.at(-1)).toMatchObject({ type: 'RUN_FINISHED', result: 'done' }); expect(execute).toHaveBeenCalledOnce();
  const foreign = await frames(await post(second.url, input('foreign'), 'bob'));
  expect(foreign.at(-1).type).toBe('RUN_ERROR');
});

it('full AGUI preserves multimodal input and replays completion as idempotent snapshots', async () => {
  const execute = vi.fn((_input: unknown, context: any) => { context.emitText('answer'); });
  const { url } = await aguiServer(execute);
  const body = input('media', { messages: [{ id: 'u', role: 'user', content: [{ type: 'image', source: { type: 'file', value: 'provider-file', provider: 'test' } }] }] });
  await frames(await post(url, body)); const replay = await frames(await post(url, body));
  expect(replay.map(event => event.type)).toContain('MESSAGES_SNAPSHOT');
  expect(replay.some(event => event.type === 'TEXT_MESSAGE_CONTENT')).toBe(false); expect(execute).toHaveBeenCalledOnce();
  expect((execute.mock.calls[0]![0] as any).messages[0].content[0].source.value).toBe('provider-file');
});

it('full AGUI rejects an unbalanced producer sequence instead of reporting success', async () => {
  const { url } = await aguiServer((_input, context) => { context.emit({ type: E.TOOL_CALL_START, toolCallId: 'open', toolCallName: 'test' }); });
  const events = await frames(await post(url, input('invalid-output')));
  expect(events.at(-1).type).toBe('RUN_ERROR'); expect(events.some(event => event.type === 'RUN_FINISHED')).toBe(false);
});

it('A2A continues an input-required task with the same id and preserved checkpoint/history', async () => {
  const { url } = await a2aServer((_message, context) => context.checkpoint ? 'resumed' : { state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED, checkpoint: { asked: true } });
  const first = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  expect(first.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
  const second = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('follow-up', { taskId: first.result.task.id }) })));
  expect(second.result.task.id).toBe(first.result.task.id); expect(second.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  expect(second.result.task.history).toHaveLength(2); expect(second.result.task.artifacts[0].parts[0].text).toBe('resumed');
});

it('A2A accepts structured/file inputs and returns file artifacts without automatic URL access', async () => {
  const execute = vi.fn(async (_message: any, context: any) => {
    await context.emitArtifact(sdk.Artifact.fromJSON({ artifactId: 'file', parts: [{ raw: Buffer.from('PDF').toString('base64'), mediaType: 'application/pdf', filename: 'report.pdf' }] }));
  });
  const { url } = await a2aServer(execute);
  const body = message('attachments', { parts: [{ data: { query: 'hello' }, mediaType: 'application/json' }, { url: 'https://example.invalid/image.png', mediaType: 'image/png' }] });
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: body })));
  expect(response.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  expect(response.result.task.artifacts[0].parts[0]).toMatchObject({ mediaType: 'application/pdf', raw: Buffer.from('PDF').toString('base64') });
  expect(execute.mock.calls[0]![0].parts[1].content.value).toBe('https://example.invalid/image.png');
});

it('official REST and JSON-RPC bindings share task identity, results and ownership', async () => {
  const { url } = await a2aServer(() => 'cross-binding');
  const response = await json(await post(url + '/a2a/rest/message:send', { message: message() }, 'alice', { 'content-type': 'application/a2a+json' }));
  expect(response.task.status.state).toBe('TASK_STATE_COMPLETED');
  const fetched = await json(await post(url + '/a2a', rpc('GetTask', { id: response.task.id })));
  expect(fetched.result.id).toBe(response.task.id);
  const denied = await json(await post(url + '/a2a', rpc('GetTask', { id: response.task.id }), 'bob'));
  expect(denied.error.code).toBe(-32001);
});

it('A2A persisted task results can be read after the service restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentarts-a2a-restart-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const first = await a2aServer(() => 'persisted', { storage: new FileProtocolStorage(directory) });
  const created = await json(await post(first.url + '/a2a', rpc('SendMessage', { message: message() })));
  await first.close();
  const second = await a2aServer(() => 'must not rerun', { storage: new FileProtocolStorage(directory) });
  const fetched = await json(await post(second.url + '/a2a', rpc('GetTask', { id: created.result.task.id })));
  expect(fetched.result.artifacts[0].parts[0].text).toBe('persisted');
});

it('official gRPC binding executes and queries a task using verified metadata', async () => {
  const server = new grpc.Server();
  const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error: Error | null, port: number) => error ? reject(error) : resolve(port)));
  cleanup.push(async () => { server.forceShutdown(); });
  const { service } = await a2aServer(() => 'grpc result', {}, `http://127.0.0.1:${port}`);
  server.addService(service.grpcDefinition, service.grpcService);
  const Client = grpc.makeGenericClientConstructor(grpcModel.A2AService, 'A2A');
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure()); cleanup.push(async () => client.close());
  const metadata = new grpc.Metadata(); metadata.set('authorization', 'Bearer alice'); metadata.set('a2a-version', '1.0');
  const result: any = await new Promise((resolve, reject) => client.sendMessage(sdk.SendMessageRequest.fromJSON({ message: message() }), metadata, (error: Error | null, response: unknown) => error ? reject(error) : resolve(response)));
  expect(result.payload.value.status.state).toBe(sdk.TaskState.TASK_STATE_COMPLETED);
});

it('push config delivery reaches an explicitly allowlisted local receiver', async () => {
  const delivered: any[] = [];
  const receiver = createServer((req, res) => { let body = ''; req.on('data', chunk => { body += chunk; }); req.on('end', () => { delivered.push(JSON.parse(body)); res.end('ok'); }); });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening'); cleanup.push(() => new Promise<void>(resolve => receiver.close(() => resolve())));
  const callback = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;
  const { url, service } = await a2aServer(() => 'notify', { push: { allowedOrigins: [callback], allowLoopbackForTesting: true } });
  const created = await json(await post(url + '/a2a', rpc('SendMessage', { message: message(), configuration: { taskPushNotificationConfig: { url: callback + '/callback', token: 'test-token' } } })));
  expect(created.result.task.status.state).toBe('TASK_STATE_COMPLETED'); await service.close();
  expect(delivered.some(event => event.statusUpdate?.status?.state === 'TASK_STATE_COMPLETED')).toBe(true);
});

it('push destinations reject nonallowlisted, private, file and credential-bearing URLs by default', async () => {
  const dispatcher = new A2aPushDispatcher({ allowedOrigins: ['https://127.0.0.1'] });
  for (const url of ['https://127.0.0.1/private', 'https://169.254.169.254/latest', 'file:///etc/passwd', 'https://user:secret@127.0.0.1/'])
    await expect(dispatcher.validate(sdk.TaskPushNotificationConfig.fromJSON({ url }))).rejects.toThrow();
});

it.each([
  { parts: [{ text: 'x', data: {} }] }, { parts: [{ raw: '?' }] },
  { parts: [{ text: 123 }] }, { parts: [{ url: false }] }, { messageId: 123 },
])('A2A rejects malformed wire content before execution: %j', async patch => {
  const execute = vi.fn(() => 'bad'); const { url } = await a2aServer(execute);
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('bad', patch) })));
  expect(response.error.code).toBe(-32602); expect(execute).not.toHaveBeenCalled();
});

it('A2A preserves null structured data and rejects unsupported MIME without execution', async () => {
  const execute = vi.fn((value: any) => { expect(value.parts[0].content).toEqual({ $case: 'data', value: null }); return 'ok'; });
  const { url } = await a2aServer(execute);
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('null', { parts: [{ data: null }] }) })));
  expect(response.result.task.history[0].parts[0]).toHaveProperty('data', null);
  const rejected = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('mime', { parts: [{ raw: 'YQ==', mediaType: 'video/mp4' }] }) })));
  expect(rejected.error).toBeDefined(); expect(execute).toHaveBeenCalledOnce();
});

it('A2A signs the final advertised capabilities and authenticates extended cards', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signCard = sdk.generateAgentCardSignature(privateKey, { alg: 'ES256', kid: 'local-test', typ: 'JOSE' });
  let publicCard: A2aServiceOptions['agentCard'];
  const { url } = await a2aServer(() => 'ok', { signCard, extendedAgentCard: async principal => ({ ...publicCard, name: 'Private ' + principal.subject }) }, undefined, card => { publicCard = card; });
  const response = await fetch(url + '/.well-known/agent-card.json', { headers: { authorization: 'Bearer alice' } });
  const card = sdk.AgentCard.fromJSON(await response.json());
  await expect(sdk.verifyAgentCardSignature(async () => publicKey)(card)).resolves.toBeUndefined();
  expect(card.capabilities?.extendedAgentCard).toBe(true);
  const extended = await json(await post(url + '/a2a', rpc('GetExtendedAgentCard', {})));
  expect(extended.result.name).toBe('Private alice');
  expect((await fetch(url + '/.well-known/agent-card.json')).status).toBe(401);
});

it('A2A final storage failure returns an error rather than a successful working result', async () => {
  const memory = new MemoryProtocolStorage();
  let fail = true;
  const storage: ProtocolStorage = {
    get: memory.get.bind(memory), list: memory.list.bind(memory),
    update: async (scope, key, change) => memory.update(scope, key, previous => {
      const next = change(previous);
      if (fail && key.startsWith('task:') && previous && (next as any)?.owner === undefined) throw new Error('PRIVATE-DISK-FAILURE');
      return next;
    }),
  };
  const { url } = await a2aServer(() => 'ok', { storage });
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  expect(response.error).toBeDefined(); expect(JSON.stringify(response)).not.toContain('PRIVATE-DISK-FAILURE');
  fail = false;
  const recovered = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  expect(recovered.result.task.status.state).toBe('TASK_STATE_INPUT_REQUIRED');
  const continued = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('retry', { taskId: recovered.result.task.id }) })));
  expect(continued.result.task.status.state).toBe('TASK_STATE_COMPLETED');
});

it('AGUI accepts frontend tool results on the next run and expands official chunk events', async () => {
  const { url } = await aguiServer((value, context) => {
    expect(value.messages.at(-1)?.role).toBe('tool');
    context.emit({ type: E.TEXT_MESSAGE_CHUNK, messageId: 'chunked', role: 'assistant', delta: 'answer' });
    context.emit({ type: E.TOOL_CALL_CHUNK, toolCallId: 'chunk-tool', toolCallName: 'lookup', delta: '{}' });
  });
  const events = await frames(await post(url, input('tool-result', { messages: [
    { id: 'assistant', role: 'assistant', toolCalls: [{ id: 'lookup', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
    { id: 'tool', role: 'tool', toolCallId: 'lookup', content: 'found' },
  ] })));
  expect(events.at(-1).type).toBe('RUN_FINISHED');
  expect(events.some(event => event.type === 'TEXT_MESSAGE_CONTENT' && event.delta === 'answer')).toBe(true);
  expect(events.some(event => event.type === 'TOOL_CALL_END')).toBe(true);
});

it('AGUI same-run concurrency cannot execute twice', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const execute = vi.fn(async (_value, context) => { await barrier; context.emitText('once'); });
  const { url } = await aguiServer(execute);
  const first = await post(url, input('race'));
  try { expect((await post(url, input('race'))).status).toBe(409); }
  finally { release(); }
  expect((await frames(first)).at(-1).type).toBe('RUN_FINISHED'); expect(execute).toHaveBeenCalledOnce();
});

it('AGUI invalid state patch cannot commit success or mutate object prototypes', async () => {
  const { url } = await aguiServer((_value, context) => context.emit({ type: E.STATE_DELTA, delta: [{ op: 'add', path: '/__proto__/polluted', value: true }] }));
  const events = await frames(await post(url, input('unsafe-patch')));
  expect(events.at(-1).type).toBe('RUN_ERROR'); expect(({} as any).polluted).toBeUndefined();
});

it('storage capacity and encryption failures preserve existing records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentarts-storage-limits-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  for (const store of [new MemoryProtocolStorage({ maxRecords: 1 }), new FileProtocolStorage(directory, { maxRecords: 1, encryptionKey: new Uint8Array(32).fill(1) })]) {
    await store.update('scope', 'one', () => ({ intact: true }));
    await expect(store.update('scope', 'two', () => ({ overflow: true }))).rejects.toThrow();
    await expect(store.update('scope', 'one', () => JSON.parse('{"__proto__":{"polluted":true}}'))).rejects.toThrow();
    expect(await store.get('scope', 'one')).toEqual({ intact: true });
  }
  await expect(new FileProtocolStorage(directory, { encryptionKey: new Uint8Array(32).fill(2) }).get('scope', 'one')).rejects.toThrow();
});

it('official AGUI client applies shared state and tools from the full producer', async () => {
  const { url } = await aguiServer((_input, context) => {
    context.emit({ type: E.STATE_SNAPSHOT, snapshot: { count: 1 } });
    const id = context.callTool('lookup', { query: 'hello' }); context.toolResult(id, 'found'); context.emitText('answer');
  });
  const client = new aguiClient.HttpAgent({ url, headers: { authorization: 'Bearer alice' }, threadId: 'official-full', messages: [{ id: 'user', role: 'user', content: 'hello' }] });
  await client.runAgent({ runId: 'official', tools: [{ name: 'lookup', description: 'lookup', parameters: {} }] });
  expect(client.state).toEqual({ count: 1 });
  expect(client.messages.some((value: any) => value.role === 'tool' && value.content === 'found')).toBe(true);
  expect(client.messages.some((value: any) => value.role === 'assistant' && value.content === 'answer')).toBe(true);
});

it('official A2A discovery client invokes the full service and lists artifacts', async () => {
  const { url } = await a2aServer(() => 'official full');
  const fetchImpl: typeof fetch = (url, init) => { const headers = new Headers(init?.headers); headers.set('authorization', 'Bearer alice'); return fetch(url, { ...init, headers }); };
  const client = await new a2aClient.ClientFactory({ transports: [new a2aClient.JsonRpcTransportFactory({ fetchImpl })], cardResolver: new a2aClient.DefaultAgentCardResolver({ fetchImpl }), clientConfig: { polling: false } }).createFromUrl(url);
  const task = await client.sendMessage(sdk.SendMessageRequest.fromJSON({ message: message() }));
  const list = await client.listTasks(sdk.ListTasksRequest.fromJSON({ includeArtifacts: true }));
  expect(list.tasks[0]?.id).toBe(task.id); expect(list.tasks[0]?.artifacts[0]?.parts[0]?.content?.value).toBe('official full');
});

it('required A2A extensions are negotiated before executor admission', async () => {
  const execute = vi.fn((_message, context) => { expect(context.extensions).toEqual(['urn:test:extension']); return 'extended'; });
  const { url } = await a2aServer(execute, {}, undefined, card => { card.capabilities = { streaming: true, pushNotifications: false, extendedAgentCard: false, extensions: [{ uri: 'urn:test:extension', required: true, description: '', params: undefined }] }; });
  const missing = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('missing') })));
  expect(missing.error).toBeDefined(); expect(execute).not.toHaveBeenCalled();
  const accepted = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('accepted') }), 'alice', { 'a2a-extensions': 'urn:test:extension' }));
  expect(accepted.result.task.status.state).toBe('TASK_STATE_COMPLETED'); expect(execute).toHaveBeenCalledOnce();
});

it('push configuration CRUD paginates and denies foreign identities', async () => {
  const { url } = await a2aServer(() => 'config', { push: { allowedOrigins: ['http://127.0.0.1:1'], allowLoopbackForTesting: true, timeoutMs: 50 } });
  const created = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  const taskId = created.result.task.id;
  for (const id of ['a', 'b', 'c']) {
    const value = await json(await post(url + '/a2a', rpc('CreateTaskPushNotificationConfig', { taskId, id, url: 'http://127.0.0.1:1/callback' })));
    expect(value.result.id).toBe(id);
  }
  const first = await json(await post(url + '/a2a', rpc('ListTaskPushNotificationConfigs', { taskId, pageSize: 2 })));
  expect(first.result.configs.map((value: any) => value.id)).toEqual(['a', 'b']);
  const second = await json(await post(url + '/a2a', rpc('ListTaskPushNotificationConfigs', { taskId, pageSize: 2, pageToken: first.result.nextPageToken })));
  expect(second.result.configs.map((value: any) => value.id)).toEqual(['c']);
  const restPage = await json(await fetch(`${url}/a2a/rest/tasks/${taskId}/pushNotificationConfigs?pageSize=2&pageToken=${first.result.nextPageToken}`, { headers: { authorization: 'Bearer alice', 'a2a-version': '1.0' } }));
  expect(restPage.configs.map((value: any) => value.id)).toEqual(['c']);
  expect((await fetch(`${url}/a2a/rest/tasks?includeArtifacts=invalid`, { headers: { authorization: 'Bearer alice', 'a2a-version': '1.0' } })).status).toBe(400);
  const denied = await json(await post(url + '/a2a', rpc('GetTaskPushNotificationConfig', { taskId, id: 'a' }), 'bob')); expect(denied.error.code).toBe(-32001);
  await post(url + '/a2a', rpc('DeleteTaskPushNotificationConfig', { taskId, id: 'a' }));
  const absent = await json(await post(url + '/a2a', rpc('GetTaskPushNotificationConfig', { taskId, id: 'a' }))); expect(absent.error).toBeDefined();
});

it('paused A2A conversation resumes after reopening the local store', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agentarts-paused-restart-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const first = await a2aServer(() => ({ state: sdk.TaskState.TASK_STATE_INPUT_REQUIRED, checkpoint: { stage: 'approve' } }), { storage: new FileProtocolStorage(directory) });
  const created = await json(await post(first.url + '/a2a', rpc('SendMessage', { message: message('first') }))); await first.close();
  const second = await a2aServer((_message, context) => { expect(context.checkpoint).toEqual({ stage: 'approve' }); return 'resumed after restart'; }, { storage: new FileProtocolStorage(directory) });
  const resumed = await json(await post(second.url + '/a2a', rpc('SendMessage', { message: message('continue', { taskId: created.result.task.id }) })));
  expect(resumed.result.task.status.state).toBe('TASK_STATE_COMPLETED'); expect(resumed.result.task.history).toHaveLength(2);
});

it('full A2A and AGUI share capacity and cancellation holds it through actual cleanup', async () => {
  const runtime = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let cleanupStarted!: () => void; const cleaning = new Promise<void>(resolve => { cleanupStarted = resolve; });
  let finishCleanup!: () => void; const cleaned = new Promise<void>(resolve => { finishCleanup = resolve; });
  const { url } = await a2aServer(async (_message, context) => {
    await new Promise<void>(resolve => { if (context.signal.aborted) resolve(); else context.signal.addEventListener('abort', () => resolve(), { once: true }); });
    cleanupStarted(); await cleaned;
  }, { runtime });
  runtime.use(createAguiAgent({ authenticate, execute: (_input, context) => { context.emitText('available'); } }));
  const server = runtime.run('127.0.0.1', 0); await once(server, 'listening');
  cleanup.push(async () => { finishCleanup(); await runtime.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const aguiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ag-ui`;
  const created = await json(await post(url + '/a2a', rpc('SendMessage', { message: message(), configuration: { returnImmediately: true } })));
  expect((await post(aguiUrl, input('busy'))).status).toBe(503);
  const cancelled = post(url + '/a2a', rpc('CancelTask', { id: created.result.task.id }));
  await cleaning;
  try { expect((await post(aguiUrl, input('cleaning'))).status).toBe(503); }
  finally { finishCleanup(); }
  expect((await json(await cancelled)).result.status.state).toBe('TASK_STATE_CANCELED');
  expect((await frames(await post(aguiUrl, input('free')))).at(-1).type).toBe('RUN_FINISHED');
});

it('AGUI releases failed storage ownership after the backend recovers', async () => {
  const memory = new MemoryProtocolStorage(); let fail = true;
  const storage: ProtocolStorage = { get: memory.get.bind(memory), list: memory.list.bind(memory), update: async (scope, key, change) => memory.update(scope, key, previous => {
    const next = change(previous); if (fail && previous && (next as any)?.owner === undefined) throw new Error('disk unavailable'); return next;
  }) };
  const { url } = await aguiServer((_input, context) => { context.emitText('ok'); }, storage);
  expect((await frames(await post(url, input('failed')))).at(-1).type).toBe('RUN_ERROR');
  fail = false;
  expect((await frames(await post(url, input('recovered')))).at(-1).type).toBe('RUN_FINISHED');
});

it('A2A status messages preserve structured null and returned artifacts replace matching ids', async () => {
  const { url } = await a2aServer(async (_message, context) => {
    await context.emitArtifact(sdk.Artifact.fromJSON({ artifactId: 'same', parts: [{ text: 'draft' }] }));
    const status = sdk.Message.fromJSON({ messageId: 'status', role: 'ROLE_AGENT', parts: [{ text: 'done' }] });
    status.parts[0]!.content = { $case: 'data', value: null };
    context.setStatus(sdk.TaskState.TASK_STATE_COMPLETED, status);
    return { artifacts: [sdk.Artifact.fromJSON({ artifactId: 'same', parts: [{ text: 'final' }] })] };
  });
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  expect(response.result.task.status.message.parts[0]).toHaveProperty('data', null);
  expect(response.result.task.artifacts).toHaveLength(1); expect(response.result.task.artifacts[0].parts[0].text).toBe('final');
});

it('A2A rejects malformed returned artifacts without reporting successful completion', async () => {
  const { url } = await a2aServer(() => ({ artifacts: [sdk.Artifact.fromJSON({ artifactId: 'empty', parts: [] })] }));
  const response = await json(await post(url + '/a2a', rpc('SendMessage', { message: message() })));
  expect(response.result.task.status.state).toBe('TASK_STATE_FAILED'); expect(response.result.task.artifacts ?? []).toHaveLength(0);
});

it('orphaned A2A execution requires explicit continuation and never automatically repeats side effects', async () => {
  const storage = new MemoryProtocolStorage();
  const scope = createHash('sha256').update(JSON.stringify(['a2a:agent', 'tenant', 'alice'])).digest('hex');
  await storage.update(scope, 'task:orphan', () => ({
    task: sdk.Task.toJSON(sdk.Task.fromJSON({ id: 'orphan', contextId: 'context', status: { state: 'TASK_STATE_WORKING', timestamp: new Date().toISOString() }, history: [message('before-crash')] })),
    owner: 'previous-process', checkpoint: { payment: 'already-issued' }, configs: [], requests: ['before-crash'],
  }));
  const execute = vi.fn((_message, context) => { expect(context.checkpoint).toEqual({ payment: 'already-issued' }); return 'continued'; });
  const { url } = await a2aServer(execute, { storage });
  const recovered = await json(await post(url + '/a2a', rpc('GetTask', { id: 'orphan' })));
  expect(recovered.result.status.state).toBe('TASK_STATE_INPUT_REQUIRED'); expect(execute).not.toHaveBeenCalled();
  const continued = await json(await post(url + '/a2a', rpc('SendMessage', { message: message('after-crash', { taskId: 'orphan' }) })));
  expect(continued.result.task.status.state).toBe('TASK_STATE_COMPLETED'); expect(execute).toHaveBeenCalledOnce();
});

it('A2A JSON-RPC, REST and gRPC do not serialize storage-provider exception messages', async () => {
  const storage: ProtocolStorage = {
    get: async () => { throw new Error('PRIVATE-SECRET-/private/backend/path'); },
    update: async () => { throw new Error('PRIVATE-SECRET'); }, list: async () => { throw new Error('PRIVATE-SECRET'); },
  };
  const server = new grpc.Server();
  const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error: Error | null, port: number) => error ? reject(error) : resolve(port)));
  cleanup.push(async () => server.forceShutdown());
  const { url, service } = await a2aServer(() => 'never', { storage }, `http://127.0.0.1:${port}`);
  server.addService(service.grpcDefinition, service.grpcService);
  const rpcResponse = await json(await post(url + '/a2a', rpc('GetTask', { id: 'id' })));
  expect(rpcResponse.error).toBeDefined(); expect(JSON.stringify(rpcResponse)).not.toContain('PRIVATE-SECRET');
  const rest = await fetch(url + '/a2a/rest/tasks/id', { headers: { authorization: 'Bearer alice', 'a2a-version': '1.0' } });
  expect(rest.status).toBe(500); expect(await rest.text()).not.toContain('PRIVATE-SECRET');
  const Client = grpc.makeGenericClientConstructor(grpcModel.A2AService, 'A2A');
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure()); cleanup.push(async () => client.close());
  const metadata = new grpc.Metadata(); metadata.set('authorization', 'Bearer alice'); metadata.set('a2a-version', '1.0');
  const error: any = await new Promise(resolve => client.getTask(sdk.GetTaskRequest.fromJSON({ id: 'id' }), metadata, (error: unknown) => resolve(error)));
  expect(error).toBeTruthy(); expect(error.details).not.toContain('PRIVATE-SECRET');
});

it('routing tenants are propagated consistently through JSON-RPC, REST and gRPC contexts', async () => {
  const server = new grpc.Server();
  const port = await new Promise<number>((resolve, reject) => server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error: Error | null, port: number) => error ? reject(error) : resolve(port)));
  cleanup.push(async () => server.forceShutdown());
  const { url, service } = await a2aServer(() => 'routed', {}, `http://127.0.0.1:${port}`, card => { for (const endpoint of card.supportedInterfaces) endpoint.tenant = 'route'; });
  server.addService(service.grpcDefinition, service.grpcService);
  const viaRpc = await json(await post(url + '/a2a', rpc('SendMessage', { tenant: 'route', message: message('rpc-route') })));
  expect(viaRpc.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  const viaRest = await json(await post(url + '/a2a/rest/route/message:send', { message: message('rest-route') }));
  expect(viaRest.task.status.state).toBe('TASK_STATE_COMPLETED');
  const Client = grpc.makeGenericClientConstructor(grpcModel.A2AService, 'A2A');
  const client = new Client(`127.0.0.1:${port}`, grpc.credentials.createInsecure()); cleanup.push(async () => client.close());
  const metadata = new grpc.Metadata(); metadata.set('authorization', 'Bearer alice'); metadata.set('a2a-version', '1.0');
  const viaGrpc: any = await new Promise((resolve, reject) => client.sendMessage(sdk.SendMessageRequest.fromJSON({ tenant: 'route', message: message('grpc-route') }), metadata, (error: Error | null, result: unknown) => error ? reject(error) : resolve(result)));
  expect(viaGrpc.payload.value.status.state).toBe(sdk.TaskState.TASK_STATE_COMPLETED);
});

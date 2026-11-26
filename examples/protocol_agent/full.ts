import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { AgentArtsRuntimeApp, FileProtocolStorage, type ProtocolAuthenticator } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { AgentCard, TaskState, createA2aService } from '@huaweicloud/agentarts-protocol-a2a';
import { createAguiAgent, EventType } from '@huaweicloud/agentarts-protocol-agui';

const token = process.env.AGENTARTS_PROTOCOL_TOKEN;
if (!token || Buffer.byteLength(token) < 32) throw new Error('Set AGENTARTS_PROTOCOL_TOKEN to a random token of at least 32 bytes');
const expected = Buffer.from(`Bearer ${token}`);
const authenticate: ProtocolAuthenticator = ({ headers }) => {
  if (typeof headers.authorization !== 'string') return null;
  const actual = Buffer.from(headers.authorization);
  return actual.length === expected.length && timingSafeEqual(actual, expected)
    ? { tenantId: 'local-demo', subject: 'authenticated-demo-user' } : null;
};
const app = new AgentArtsRuntimeApp({ maxConcurrency: 4 });
const key = process.env.AGENTARTS_PROTOCOL_STORAGE_KEY;
if (key && !/^[a-f0-9]{64}$/i.test(key)) throw new Error('Storage key must be 64 hexadecimal characters');
const storage = new FileProtocolStorage(process.env.AGENTARTS_PROTOCOL_STORAGE_DIR ?? '.agentarts-protocol', {
  ...(key ? { encryptionKey: Buffer.from(key, 'hex') } : {}),
});
const origins = process.env.AGENTARTS_PROTOCOL_ORIGINS?.split(',').filter(Boolean);
app.use(createAguiAgent({ authenticate, storage, allowedOrigins: origins, execute(input, context) {
  // Application code chooses which operations to expose. Never execute arbitrary client-supplied code.
  if (!context.checkpoint) {
    context.emit({ type: EventType.STATE_SNAPSHOT, snapshot: { stage: 'awaiting-approval' } });
    return context.interrupt([{ id: 'approval', reason: 'confirmation', message: 'Approve the local demonstration?' }], { stage: 'approval' });
  }
  const answer = context.resume.find(item => item.interruptId === 'approval');
  if (!answer || answer.status !== 'resolved' || answer.payload !== true) return { outcome: { type: 'cancelled' } };
  if (input.tools.some(tool => tool.name === 'showNotification')) context.callTool('showNotification', { text: 'Approved' });
  context.emitText('Approved. The saved checkpoint and shared state survived the previous run.');
  return { result: { approved: true } };
} }));
const a2aPort = Number(process.env.A2A_PORT ?? 8001);
const origin = process.env.AGENTARTS_PROTOCOL_PUBLIC_ORIGIN ?? `http://127.0.0.1:${a2aPort}`;
const service = createA2aService({ runtime: app, authenticate, storage, allowedOrigins: origins,
  agentCard: AgentCard.fromJSON({ name: 'Persistent AgentArts demo', version: '1.0', description: 'Local approval workflow',
    supportedInterfaces: [
      { url: origin + '/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' },
      { url: origin + '/a2a/rest', protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
    ], defaultInputModes: ['text/plain', 'application/json', 'application/octet-stream'], defaultOutputModes: ['text/plain'],
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } }, securityRequirements: [{ schemes: { bearer: { list: [] } } }], skills: [],
  }),
  execute(message, context) {
    if (!context.checkpoint) return { state: TaskState.TASK_STATE_INPUT_REQUIRED, checkpoint: { stage: 'approval' } };
    const approved = message.parts.some(part => part.content?.$case === 'text' && part.content.value.trim() === 'approve');
    return approved ? 'Approved using the persisted checkpoint.' : { state: TaskState.TASK_STATE_REJECTED };
  },
});
const host = process.env.AGENTARTS_BIND_IP ?? '127.0.0.1';
const aguiServer = app.run(host, Number(process.env.PORT ?? 8000));
const a2aServer = createServer(service.http).listen(a2aPort, host);
const stop = async () => {
  await app.shutdown(); // Closes both protocol engines and waits for actual execution cleanup.
  for (const server of [aguiServer, a2aServer]) { server.closeAllConnections(); server.close(); }
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });

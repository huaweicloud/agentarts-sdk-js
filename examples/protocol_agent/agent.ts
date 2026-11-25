import { timingSafeEqual } from 'node:crypto';
import { AgentArtsRuntimeApp } from '@huaweicloud/agentarts-sdk';
import type { ProtocolAuthenticator, TextExecutor } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { AgentCard, createA2aAdapter } from '@huaweicloud/agentarts-protocol-a2a';
import { createAguiAdapter } from '@huaweicloud/agentarts-protocol-agui';

const token = process.env.AGENTARTS_PROTOCOL_TOKEN;
if (!token || Buffer.byteLength(token) < 32)
  throw new Error('Set AGENTARTS_PROTOCOL_TOKEN to a random token of at least 32 bytes');
const expected = Buffer.from(`Bearer ${token}`);
const authenticate: ProtocolAuthenticator = ({ headers }) => {
  const value = headers.authorization;
  if (typeof value !== 'string') return null;
  const supplied = Buffer.from(value);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  // Single-user local demonstration. Production providers must verify credentials
  // and resolve tenant/subject server-side, never from the message body.
  return { tenantId: 'local-demo', subject: 'authenticated-demo-user' };
};
const execute: TextExecutor = (input, context) => {
  const value = input as {
    messages?: Array<{ role: string; content: string }>;
    parts?: Array<{ text?: string }>;
  };
  const prompt =
    value.messages?.filter((message) => message.role === 'user').at(-1)?.content ??
    value.parts?.map((part) => part.text ?? '').join('') ??
    '';
  const response = `Echo: ${prompt}`;
  context.emitText(response);
  return response;
};
const port = Number(process.env.PORT ?? 8000);
const publicUrl = process.env.AGENTARTS_PROTOCOL_PUBLIC_URL ?? `http://127.0.0.1:${port}/a2a`;
const origins = process.env.AGENTARTS_PROTOCOL_ORIGINS?.split(',').filter(Boolean);
const card = AgentCard.fromJSON({
  name: 'AgentArts protocol example',
  description: 'Authenticated text-only A2A / AG-UI demo',
  version: '1.0.0',
  supportedInterfaces: [{ url: publicUrl, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
  securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'bearer' } } },
  securityRequirements: [{ schemes: { bearer: { list: [] } } }],
  skills: [{ id: 'echo', name: 'Echo', description: 'Echoes user text', tags: ['text'] }],
});
const app = new AgentArtsRuntimeApp({ maxConcurrency: 4 });
app.use(createA2aAdapter({ agentCard: card, authenticate, execute, allowedOrigins: origins }));
app.use(createAguiAdapter({ authenticate, execute, allowedOrigins: origins }));
// No legacy entrypoint / WS handler is registered: do not accidentally expose
// an unauthenticated alternative path around the protocol authenticators.
const server = app.run(process.env.AGENTARTS_BIND_IP ?? '127.0.0.1', port);
const stop = async () => {
  await app.shutdown();
  server.closeAllConnections();
  server.close();
};
process.once('SIGINT', () => {
  void stop();
});
process.once('SIGTERM', () => {
  void stop();
});

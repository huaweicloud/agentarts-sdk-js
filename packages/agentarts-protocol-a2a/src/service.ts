import express, { type Express, type Request, type Response as ExpressResponse, type NextFunction } from 'express';
import * as grpc from '@grpc/grpc-js';
import { AgentCard } from '@a2a-js/sdk';
import { jsonRpcHandler, restHandler } from '@a2a-js/sdk/server/express';
import { A2AService, grpcService } from '@a2a-js/sdk/server/grpc';
import { ServerCallContext, type ServerCallContextBuilder, type A2ARequestHandler } from '@a2a-js/sdk/server';
import { A2AError, RequestMalformedError, TaskNotFoundError, TaskNotCancelableError, UnsupportedOperationError, PushNotificationNotSupportedError, ExtensionSupportRequiredError, ContentTypeNotSupportedError } from '@a2a-js/sdk/errors';
import { authenticateProtocol, makeProtocolRequest, protocolCors, protocolOrigins, ProtocolHttpError, ExecutionError, boundedInteger, type ProtocolAuthenticator, type ExecutionPrincipal } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { A2aAgentEngine, type A2aEngineOptions } from './engine.js';
import { A2aPushDispatcher, type A2aPushOptions } from './push.js';
import { normalizeRpc, normalizeSend, normalizePush } from './wire.js';

export interface A2aServiceOptions extends Omit<A2aEngineOptions, 'authenticateScope' | 'push'> {
  authenticate: ProtocolAuthenticator;
  rpcPath?: string;
  restPath?: string;
  cardPath?: string;
  publicAgentCard?: boolean;
  allowedOrigins?: readonly string[];
  push?: A2aPushOptions;
  maxRequests?: number;
}
/** Official JSON-RPC/REST/gRPC bindings share one engine, verified identities, storage and execution permits. */
export interface A2aService {
  http: Express;
  grpcService: grpc.UntypedServiceImplementation;
  grpcDefinition: grpc.ServiceDefinition;
  handler: A2ARequestHandler;
  close(): Promise<void>;
}
function safeError(error: unknown): A2AError {
  // Official transport bindings serialize exception messages. Keep protocol
  // semantics but never expose backend paths, DNS errors or provider payloads.
  for (const [Type, message] of [
    [TaskNotFoundError, 'Task or configuration not found'], [TaskNotCancelableError, 'Task is not cancelable'],
    [UnsupportedOperationError, 'Operation is not supported in the current state'],
    [RequestMalformedError, 'Invalid request parameters'], [PushNotificationNotSupportedError, 'Push notifications are not enabled'],
    [ExtensionSupportRequiredError, 'Required extension was not activated'], [ContentTypeNotSupportedError, 'Unsupported content type'],
  ] as const) if (error instanceof Type) return new Type(message);
  if (error instanceof ProtocolHttpError && error.status === 400) return new RequestMalformedError('Invalid request parameters');
  if (error instanceof ExecutionError && ['INVALID_INPUT', 'INPUT_LIMIT'].includes(error.code)) return new RequestMalformedError('Invalid request parameters');
  return new A2AError('Internal server error');
}
function guarded(engine: A2aAgentEngine): A2ARequestHandler {
  return new Proxy(engine, { get(target, key) {
    const method = Reflect.get(target, key);
    if (typeof method !== 'function') return method;
    if (key === 'sendMessageStream' || key === 'resubscribe') return async function* (...args: unknown[]) {
      try { yield* method.apply(target, args); } catch (error) { throw safeError(error); }
    };
    return async (...args: unknown[]) => { try { return await method.apply(target, args); } catch (error) { throw safeError(error); } };
  } });
}
export function createA2aService(options: A2aServiceOptions): A2aService {
  const rpcPath = options.rpcPath ?? '/a2a';
  const restPath = options.restPath ?? '/a2a/rest';
  const cardPath = options.cardPath ?? '/.well-known/agent-card.json';
  if (typeof options.authenticate !== 'function' || typeof options.execute !== 'function') throw new TypeError('authenticate and execute are required');
  boundedInteger(options.maxRequests ?? 64, 'maxRequests');
  for (const path of [rpcPath, restPath, cardPath]) if (!/^\/[A-Za-z0-9._/-]+$/.test(path) || path.includes('//') || path.split('/').includes('..')) throw new TypeError('Invalid service path');
  if (new Set([rpcPath, restPath, cardPath]).size !== 3) throw new TypeError('Service paths must be distinct');
  const origins = protocolOrigins(options.allowedOrigins);
  const authenticated = new WeakMap<Request, ExecutionPrincipal>();
  const wireMessages = new WeakMap<object, unknown>();
  const pushPages = new WeakMap<object, { pageSize?: number; pageToken?: string }>();
  const routing = options.agentCard.supportedInterfaces[0]?.tenant ?? '';
  if (!options.agentCard.supportedInterfaces.length || options.agentCard.supportedInterfaces.some(endpoint => endpoint.tenant !== routing || endpoint.protocolVersion !== '1.0')) throw new TypeError('All A2A interfaces require version 1.0 and one routing tenant');
  const card = AgentCard.fromJSON(AgentCard.toJSON(options.agentCard));
  const validateCard = (card: AgentCard) => {
    if (!card.name || !card.description || !card.version || !card.supportedInterfaces.length || !card.securityRequirements.length || !Object.keys(card.securitySchemes).length || (card.signatures.length && !options.signCard)) throw new TypeError('Agent card requires identity, security and a signer for signed cards');
    for (const endpoint of card.supportedInterfaces) {
      const url = new URL(endpoint.url);
      if (endpoint.protocolVersion !== '1.0' || endpoint.tenant !== routing || !['JSONRPC', 'HTTP+JSON', 'GRPC'].includes(endpoint.protocolBinding) || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
          (endpoint.protocolBinding === 'JSONRPC' && url.pathname !== rpcPath) || (endpoint.protocolBinding === 'HTTP+JSON' && url.pathname !== restPath)) throw new TypeError('Invalid advertised interface');
    }
  };
  validateCard(card);
  card.signatures = []; // Capability changes require signing the final card, never retaining stale signatures.
  card.capabilities = { streaming: true, pushNotifications: !!options.push, extendedAgentCard: !!options.extendedAgentCard, extensions: card.capabilities?.extensions ?? [] };
  const push = options.push ? new A2aPushDispatcher(options.push) : undefined;
  const engine = new A2aAgentEngine({ ...options, agentCard: card, signCard: options.signCard && (async value => {
    const signed = await options.signCard!(value);
    validateCard(signed);
    return signed;
  }), extendedAgentCard: options.extendedAgentCard && (async principal => {
    const extended = AgentCard.fromJSON(AgentCard.toJSON(await options.extendedAgentCard!(principal)));
    validateCard(extended);
    if (options.signCard) extended.signatures = [];
    return extended;
  }), ...(push ? { push } : { push: undefined }), authenticateScope(context) {
    if (!context.user?.isAuthenticated) throw new RequestMalformedError('Authentication required');
    if ((context.tenant ?? '') !== routing) throw new RequestMalformedError('Routing tenant mismatch');
    try {
      const [tenantId, subject] = JSON.parse(context.user.userName);
      return { tenantId, subject };
    } catch { throw new RequestMalformedError('Invalid verified identity'); }
  } });
  const handler = guarded(engine);
  const user = (principal: ExecutionPrincipal) => ({ isAuthenticated: true, userName: JSON.stringify([principal.tenantId, principal.subject]) });
  const contextBuilder: ServerCallContextBuilder = values => {
    const context = new ServerCallContext({ user: values.user, requestedExtensions: values.extensions, requestedVersion: values.requestedVersion, tenant: values.tenant });
    if (values.user && wireMessages.has(values.user)) context.state.set('agentarts:message', wireMessages.get(values.user));
    if (values.user && pushPages.has(values.user)) context.state.set('agentarts:push-page', pushPages.get(values.user));
    return context;
  };
  const app = express();
  app.disable('x-powered-by');
  let active = 0;
  let closing = false;
  app.use((req, res, next) => {
    if (closing || active >= (options.maxRequests ?? 64)) { res.status(503).json({ error: 'SERVICE_CAPACITY' }); return; }
    active++;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } };
    res.once('finish', release); res.once('close', release);
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    // Keep observing body errors after parser cleanup, including ECONNRESET.
    req.on('error', () => {});
    const request = makeProtocolRequest(req, req.path, controller.signal, req.path.startsWith(restPath + '/') ? ['application/json', 'application/a2a+json'] : ['application/json']);
    void (async () => {
      const cors = protocolCors(request, origins, ['GET', 'POST', 'DELETE'], ['authorization', 'content-type', 'a2a-version', 'a2a-extensions']);
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      if (req.method === 'OPTIONS') { res.status(204).end(); return; }
      if (!(options.publicAgentCard && req.path === cardPath && req.method === 'GET')) authenticated.set(req, await authenticateProtocol(request, options.authenticate));
      const restWithoutBody = req.path.startsWith(restPath + '/') && /\/(?:tasks\/[^/]+):(?:cancel|subscribe)\/?$/i.test(req.path);
      if (req.method === 'POST' && req.headers['content-length'] !== '0')
        req.body = await request.json(undefined, undefined, restWithoutBody);
      if (req.path === rpcPath && req.method === 'POST') req.body = normalizeRpc(req.body);
      else if (req.path.startsWith(restPath + '/') && /\/message:(send|stream)$/.test(req.path)) req.body = normalizeSend(req.body);
      else if (req.path.startsWith(restPath + '/') && req.method === 'POST' && /\/pushNotificationConfigs$/.test(req.path)) req.body = normalizePush(req.body);
      if (req.path.startsWith(restPath + '/')) {
        for (const field of ['pageSize', 'historyLength']) {
          const value = req.query[field];
          if (value !== undefined && (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value)) || (field === 'pageSize' && (Number(value) < 1 || Number(value) > 100)))) throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid query parameters');
        }
        if (req.query.includeArtifacts !== undefined && !['true', 'false'].includes(req.query.includeArtifacts as string)) throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid query parameters');
        if (req.query.pageToken !== undefined && (typeof req.query.pageToken !== 'string' || req.query.pageToken.length > 2048)) throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid query parameters');
      }
      next();
    })().catch(next);
  });
  const userBuilder = async (req: Request) => {
    const principal = authenticated.get(req);
    if (!principal) throw new RequestMalformedError('Authentication required');
    const verified = user(principal);
    const message = req.body?.params?.message ?? req.body?.message;
    if (message) wireMessages.set(verified, message);
    if (req.method === 'GET' && /\/pushNotificationConfigs$/.test(req.path)) pushPages.set(verified, {
      ...(req.query.pageSize !== undefined ? { pageSize: Number(req.query.pageSize) } : {}),
      ...(req.query.pageToken !== undefined ? { pageToken: String(req.query.pageToken) } : {}),
    });
    return verified;
  };
  app.get(cardPath, (_req, res, next) => { void handler.getAgentCard().then(value => { res.setHeader('cache-control', 'no-store'); res.json(AgentCard.toJSON(value)); }).catch(next); });
  // Mount the more specific REST prefix first; JSON-RPC's router handles only its exact root.
  app.use(restPath, restHandler({ requestHandler: handler, userBuilder, contextBuilder }));
  app.use(rpcPath, jsonRpcHandler({ requestHandler: handler, userBuilder, contextBuilder }));
  app.use((_req, res) => { res.status(404).json({ error: 'NOT_FOUND' }); });
  app.use((error: unknown, req: Request, res: ExpressResponse, _next: NextFunction) => {
    if (res.headersSent) { res.destroy(); return; }
    res.setHeader('connection', 'close');
    if (req.path === rpcPath && req.method === 'POST' && authenticated.has(req) && ((error instanceof ProtocolHttpError && error.status === 400) || (error instanceof Error && error.name === 'ExecutionError'))) {
      const code = error instanceof ProtocolHttpError && error.code === 'INVALID_JSON' ? -32700 : error instanceof ProtocolHttpError && error.code === 'INVALID_REQUEST' ? -32600 : -32602;
      const id = code === -32700 ? null : typeof req.body?.id === 'string' || Number.isSafeInteger(req.body?.id) ? req.body.id : null;
      res.status(400).json({ jsonrpc: '2.0', id, error: { code, message: code === -32700 ? 'Invalid JSON' : code === -32600 ? 'Invalid request' : 'Invalid parameters' } }); return;
    }
    res.status(error instanceof ProtocolHttpError ? error.status : 500).json({ error: error instanceof ProtocolHttpError ? error.code : 'INTERNAL_ERROR' });
  });
  const grpcImplementation = grpcService({ requestHandler: handler, contextBuilder, userBuilder: async call => {
    const controller = new AbortController(); call.once('cancelled', () => controller.abort());
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(call.metadata.getMap())) if (typeof value === 'string') headers[key] = value;
    try { return user(await authenticateProtocol({ headers, signal: controller.signal } as Parameters<typeof authenticateProtocol>[0], options.authenticate)); }
    catch { throw Object.assign(new Error('Authentication required'), { code: grpc.status.UNAUTHENTICATED }); }
  } });
  let unregister: (() => void) | undefined;
  const close = async () => { closing = true; await engine.shutdown(); await push?.flush(); unregister?.(); };
  unregister = options.runtime.onProtocolShutdown(close);
  return {
    http: app,
    grpcService: grpcImplementation,
    grpcDefinition: A2AService,
    handler,
    close,
  };
}

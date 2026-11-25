import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import {
  ExecutionError,
  boundedInteger,
  requireIdentifier,
  type ExecutionCoordinator,
  type ExecutionPrincipal,
} from './execution.js';
import type { Response } from './app.js';
import type { Logger } from '../utils/logging.js';

export class ProtocolHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ProtocolHttpError';
  }
}
export interface ProtocolRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<IncomingHttpHeaders>;
  readonly signal: AbortSignal;
  json(maxBytes?: number, timeoutMs?: number, allowEmpty?: boolean): Promise<unknown>;
}
export interface ProtocolHost {
  readonly executions: ExecutionCoordinator;
  readonly logger: Logger;
  acquireSlot(): { release(): void };
}
export interface RuntimeProtocol {
  /** Explicit exact paths. No wildcard handlers and no interception of legacy routes. */
  readonly routes: ReadonlyArray<{ readonly path: string; readonly methods: readonly string[] }>;
  handle(request: ProtocolRequest, host: ProtocolHost): Promise<Response>;
  shutdown?(): Promise<void>;
}
const authentications = new WeakMap<ProtocolAuthenticator, number>();
export type ProtocolAuthenticator = (
  request: Pick<ProtocolRequest, 'headers' | 'signal'>,
) => ExecutionPrincipal | null | Promise<ExecutionPrincipal | null>;
/** Auth providers verify credentials; identity is never inferred from JSON or tenant query fields. */
export async function authenticateProtocol(
  request: ProtocolRequest,
  authenticate: ProtocolAuthenticator,
  timeoutMs = 5000,
): Promise<ExecutionPrincipal> {
  boundedInteger(timeoutMs, 'authentication timeout', 2147483647);
  if (request.signal.aborted)
    throw new ProtocolHttpError(408, 'REQUEST_ABORTED', 'Request aborted');
  if ((authentications.get(authenticate) ?? 0) >= 64)
    throw new ProtocolHttpError(503, 'AUTHENTICATION_CAPACITY', 'Authentication capacity reached');
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      cancel = () => reject(new ProtocolHttpError(408, 'REQUEST_ABORTED', 'Request aborted'));
      request.signal.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        reject(new ProtocolHttpError(401, 'UNAUTHENTICATED', 'Authentication failed'));
      }, timeoutMs);
    });
    authentications.set(authenticate, (authentications.get(authenticate) ?? 0) + 1);
    const operation = Promise.resolve()
      .then(async () => {
        if (controller.signal.aborted)
          throw new ProtocolHttpError(408, 'REQUEST_ABORTED', 'Request aborted');
        try {
          const principal = await authenticate({
            headers: request.headers,
            signal: controller.signal,
          });
          if (!principal) return null;
          // The provider owns its exceptions (including ProtocolHttpError) and
          // property accessors. None of their messages, codes or headers are public.
          return Object.freeze({
            tenantId: requireIdentifier(principal.tenantId, 'tenantId'),
            subject: requireIdentifier(principal.subject, 'subject'),
          });
        } catch {
          throw new ProtocolHttpError(401, 'UNAUTHENTICATED', 'Authentication failed');
        }
      })
      .finally(() => {
        const pending = (authentications.get(authenticate) ?? 1) - 1;
        if (pending) authentications.set(authenticate, pending);
        else authentications.delete(authenticate);
      });
    const principal = await Promise.race([operation, timeout]);
    if (!principal) throw new ProtocolHttpError(401, 'UNAUTHENTICATED', 'Authentication required');
    return principal;
  } catch (error) {
    if (error instanceof ProtocolHttpError) throw error;
    // Provider exception messages can contain credentials; do not reflect or log them.
    throw new ProtocolHttpError(401, 'UNAUTHENTICATED', 'Authentication failed');
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener('abort', abort);
    if (cancel) request.signal.removeEventListener('abort', cancel);
  }
}

export function makeProtocolRequest(
  req: IncomingMessage,
  path: string,
  signal: AbortSignal,
  contentTypes: readonly string[] = ['application/json'],
): ProtocolRequest {
  let consumed = false;
  return {
    method: req.method ?? 'GET',
    path,
    headers: Object.freeze({ ...req.headers }),
    signal,
    json(maxBytes = 1024 * 1024, timeoutMs = 10000, allowEmpty = false) {
      boundedInteger(maxBytes, 'request byte limit', 16 * 1024 * 1024);
      boundedInteger(timeoutMs, 'body timeout', 2147483647);
      if (consumed)
        return Promise.reject(new ProtocolHttpError(400, 'INVALID_BODY', 'Body already consumed'));
      consumed = true;
      const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      if (!allowEmpty && (!contentType || !contentTypes.includes(contentType)))
        return Promise.reject(
          new ProtocolHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json required'),
        );
      return new Promise<unknown>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const fail = (status: number, code: string, message: string) => {
          cleanup();
          req.pause();
          reject(new ProtocolHttpError(status, code, message));
        };
        const data = (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) fail(413, 'BODY_TOO_LARGE', 'Request body too large');
          else chunks.push(chunk);
        };
        const end = () => {
          cleanup();
          if (allowEmpty && bytes === 0) { resolve({}); return; }
          if (!contentType || !contentTypes.includes(contentType)) {
            reject(new ProtocolHttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'application/json required'));
            return;
          }
          try {
            const value: unknown = JSON.parse(
              new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
            );
            let nodes = 0;
            const inspect = (item: unknown, depth: number): void => {
              if (depth > 64 || ++nodes > 20000) throw new Error('JSON complexity limit');
              if (item && typeof item === 'object')
                for (const key of Object.keys(item)) {
                  if (['__proto__', 'constructor', 'prototype'].includes(key))
                    throw new Error('Unsafe JSON key');
                  inspect((item as Record<string, unknown>)[key], depth + 1);
                }
            };
            inspect(value, 0);
            resolve(value);
          } catch {
            reject(new ProtocolHttpError(400, 'INVALID_JSON', 'Invalid JSON'));
          }
        };
        const aborted = () => fail(408, 'REQUEST_ABORTED', 'Request aborted');
        const failed = () => fail(400, 'INVALID_BODY', 'Cannot read request body');
        const timer = setTimeout(
          () => fail(408, 'BODY_TIMEOUT', 'Request body timed out'),
          timeoutMs,
        );
        function cleanup() {
          clearTimeout(timer);
          req.off('data', data);
          req.off('end', end);
          req.off('error', failed);
          signal.removeEventListener('abort', aborted);
        }
        req.on('data', data);
        req.once('end', end);
        req.once('error', failed);
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted || req.aborted) aborted();
        else if (req.readableEnded) end();
      });
    },
  };
}

export function protocolFailure(error: unknown): ProtocolHttpError {
  if (error instanceof ProtocolHttpError) return error;
  if (error instanceof ExecutionError) {
    const status =
      error.code === 'INPUT_LIMIT'
        ? 413
        : error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'CONFLICT'
            ? 409
            : error.code === 'CAPACITY'
              ? 503
              : 400;
    return new ProtocolHttpError(status, error.code, error.message);
  }
  if (error instanceof Error && error.name === 'ConcurrencyLimitError')
    return new ProtocolHttpError(503, 'CONCURRENCY_LIMIT_EXCEEDED', 'Service busy');
  return new ProtocolHttpError(500, 'INTERNAL_ERROR', 'Internal error');
}

/** Explicit origins only. No wildcard origins or ambient-cookie credential grants. */
export function protocolOrigins(origins: readonly string[] = []): readonly string[] {
  if (origins.length > 32) throw new RangeError('Too many CORS origins');
  return Object.freeze(
    origins.map((value) => {
      const url = new URL(value);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== '/' ||
        url.hostname.includes('*')
      )
        throw new TypeError('Invalid CORS origin');
      return url.origin;
    }),
  );
}
export function protocolCors(
  request: ProtocolRequest,
  origins: readonly string[],
  methods: readonly string[],
  headers: readonly string[],
): Record<string, string> {
  const origin = request.headers.origin;
  if (origin === undefined && request.method !== 'OPTIONS') return {};
  if (typeof origin !== 'string' || !origins.includes(origin))
    throw new ProtocolHttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin not allowed');
  const cors: Record<string, string> = { 'access-control-allow-origin': origin, vary: 'Origin' };
  if (request.method === 'OPTIONS') {
    const method = request.headers['access-control-request-method'];
    const requested = request.headers['access-control-request-headers'];
    if (
      typeof method !== 'string' ||
      !methods.includes(method) ||
      (requested !== undefined &&
        (typeof requested !== 'string' ||
          requested.split(',').some((header) => !headers.includes(header.trim().toLowerCase()))))
    ) {
      throw new ProtocolHttpError(403, 'PREFLIGHT_NOT_ALLOWED', 'Preflight not allowed');
    }
    cors['access-control-allow-methods'] = methods.join(', ');
    cors['access-control-allow-headers'] = headers.join(', ');
    cors['access-control-max-age'] = '600';
  }
  return cors;
}

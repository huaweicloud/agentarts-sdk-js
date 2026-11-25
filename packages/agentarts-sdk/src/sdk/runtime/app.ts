/**
 * AgentArts Runtime Application.
 *
 * Node.js port of `agentarts/sdk/runtime/app.py`.
 *
 * Provides the core HTTP/WebSocket server that wraps user-defined agent
 * entrypoints and exposes them through a standardised API surface compatible
 * with the Huawei Cloud AgentArts control plane.
 *
 * Endpoints
 * ---------
 * - `POST /invocations` - invoke the agent entrypoint
 * - `GET  /ping`         - health-check / liveness probe
 * - `WS   /ws`           - bidirectional streaming communication
 *
 * The Python implementation is built on Starlette/uvicorn. This port uses
 * `node:http` plus the `ws` package (already a dependency), so it needs no
 * ASGI server and no additional packages.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket as WsWebSocket } from 'ws';

import { AgentArtsRuntimeContext, RequestContext } from './context.js';
import { ExecutionCoordinator, boundedInteger, type ExecutionLimits } from './execution.js';
import { ProtocolHttpError, makeProtocolRequest, type RuntimeProtocol } from './protocol.js';
import {
  ACCESS_TOKEN_HEADER,
  PingStatus,
  SESSION_HEADER,
  USER_ID_HEADER,
  toPingStatus,
} from './model.js';
import { getLogger, type Logger } from '../utils/logging.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Main agent invocation handler registered through {@link AgentArtsRuntimeApp.entrypoint}. */
export type RuntimeHandler = (payload: any, context?: RequestContext) => any;

/** Health-check handler registered through {@link AgentArtsRuntimeApp.ping}. */
export type RuntimePingHandler = (
  context?: RequestContext | null,
) => PingStatus | string | Promise<PingStatus | string>;

/** WebSocket handler registered through {@link AgentArtsRuntimeApp.websocket}. */
export type RuntimeWebSocketHandler = (
  websocket: WebSocketConnection,
  context: RequestContext,
) => void | Promise<void>;

/** Background task handler accepted by {@link AgentArtsRuntimeApp.asyncTask}. */
export type RuntimeAsyncTaskHandler = (...args: any[]) => Promise<any>;

/** Result of wrapping a handler with {@link AgentArtsRuntimeApp.asyncTask}. */
export type RuntimeAsyncTaskFunction<T extends RuntimeAsyncTaskHandler = RuntimeAsyncTaskHandler> = T & {
  _isAsyncTask: true;
  _originalFunc: T;
};

/** Start/stop hooks, called from {@link AgentArtsRuntimeApp.run}. */
export interface RuntimeLifespan {
  onStartup?: () => void | Promise<void>;
  onShutdown?: () => void | Promise<void>;
}

/** Options accepted by {@link AgentArtsRuntimeApp}. */
export interface AgentArtsRuntimeAppOptions {
  /** Enable debug logging (mirrors Starlette's `debug` flag). */
  debug?: boolean;
  /** Advertised protocol, only used for logging. Defaults to `'http'`. */
  protocol?: 'http' | 'https';
  /** Maximum concurrent executions shared by HTTP and explicitly acquired slots. Defaults to `15`. */
  maxConcurrency?: number;
  executionLimits?: ExecutionLimits;
  /** Bound active requests to optional protocol routes, including subscriptions. */
  maxProtocolRequests?: number;
  /** Optional startup/shutdown hooks (the Node equivalent of an ASGI lifespan). */
  lifespan?: RuntimeLifespan | null;
}

/** Request object shape consumed by the endpoint handlers (Python `Request`). */
export interface HttpRequestLike {
  headers?: any;
  signal?: AbortSignal;
}

/** A process-local execution permit. Release only after execution cleanup completes. */
export interface SlotLease {
  /** Idempotent: releasing twice never returns an extra permit. */
  release(): void;
}

function streamIterator<T>(content: Iterable<T> | AsyncIterable<T>): Iterator<T> | AsyncIterator<T> {
  const asyncIterator = (content as AsyncIterable<T>)[Symbol.asyncIterator];
  return typeof asyncIterator === 'function'
    ? asyncIterator.call(content)
    : (content as Iterable<T>)[Symbol.iterator]();
}

/** Own the raw iterator, its in-flight work and cleanup independently of SSE formatting. */
function retainSlot<T>(
  content: Iterable<T> | AsyncIterable<T>,
  lease: SlotLease,
  format?: (value: T) => string | Buffer,
  formatError?: (error: unknown, cleanupFailure?: { error: unknown }) => string | Buffer,
): AsyncIterableIterator<string | Buffer> {
  let iterator: Iterator<T> | AsyncIterator<T> | undefined;
  let closed = false;
  let sourceFinished = false;
  let cleanupFailureHandled = false;
  let closing: Promise<IteratorResult<string | Buffer>> | undefined;
  const pending = new Set<Promise<IteratorResult<T>>>();
  const getIterator = () => (iterator ??= streamIterator(content));
  const close = (cancel = true): Promise<IteratorResult<string | Buffer>> => {
    if (closing) return closing;
    closed = true;
    // Queue cleanup so closing is assigned before invoking user iterator methods.
    closing = Promise.resolve().then(async () => {
      try {
        // return() may cancel next(), or (as with async generators) wait for it.
        // Await raw operations, never wrapper next() promises which await close().
        const returned = Promise.resolve().then(async () => {
          // Natural exhaustion already completed the execution. return() is an
          // early termination hook, not a second completion notification.
          if (!cancel) return;
          const source = getIterator();
          let result: IteratorResult<T> | undefined;
          const terminate: (() => IteratorResult<T> | Promise<IteratorResult<T>>) | undefined = source.return;
          if (terminate != null) {
            result = await terminate.call(source);
          } else {
            // No cancellation hook: finish any existing reads first, then drain
            // to natural completion. Absence of return() is not completion.
            await Promise.allSettled([...pending]);
            if (sourceFinished) return;
            result = await source.next();
          }
          // Generators may yield from finally while handling return(). Those
          // cleanup yields must be exhausted before execution actually finishes.
          let drained = 0;
          while (result && !result.done) {
            // A synchronous producer can otherwise starve the event loop while
            // the disconnected response is drained without write backpressure.
            if (++drained % 256 === 0) {
              await new Promise<void>(resolve => setImmediate(resolve));
            }
            result = await source.next();
          }
          sourceFinished = true;
        });
        const results = await Promise.allSettled([...pending, returned]);
        const cleanup = results[results.length - 1]!;
        if (cleanup.status === 'rejected') throw cleanup.reason;
        return { done: true, value: undefined } as const;
      } finally {
        lease.release();
      }
    });
    return closing;
  };
  return {
    [Symbol.asyncIterator]() { return this; },
    async next() {
      if (closed) {
        return { done: true, value: undefined };
      }
      const operation = Promise.resolve().then(async () => {
        try {
          const result = await getIterator().next();
          if (result.done) sourceFinished = true;
          return result;
        } catch (error) {
          // A failed read terminates execution; do not restart a source without
          // return() by calling next() again while handling that failure.
          sourceFinished = true;
          throw error;
        }
      });
      pending.add(operation);
      // Observe rejection immediately without creating an unhandled finally promise.
      void operation.then(() => pending.delete(operation), () => pending.delete(operation));
      try {
        const result = await operation;
        if (closed) return { done: true, value: undefined };
        if (result.done) return await close(false);
        return { done: false, value: format ? format(result.value) : result.value as string | Buffer };
      } catch (error) {
        const report = !closed;
        if (report && formatError) {
          let cleanupFailure: { error: unknown } | undefined;
          try {
            await close();
          } catch (failure) {
            cleanupFailure = { error: failure };
          }
          const frame = formatError(error, cleanupFailure);
          cleanupFailureHandled = cleanupFailure !== undefined;
          return { done: false, value: frame };
        }
        await close();
        throw error;
      }
    },
    async return() {
      try {
        return await close();
      } catch (error) {
        // A raw SSE failure has already reported this cleanup error. Do not let
        // the response's final return() replace that error frame with HTTP 500.
        if (cleanupFailureHandled) return { done: true, value: undefined };
        throw error;
      }
    },
  };
}

/** A round was rejected before it started because all execution permits are in use. */
export class ConcurrencyLimitError extends Error {
  readonly code = 'CONCURRENCY_LIMIT_EXCEEDED';

  constructor() {
    super('Service busy - maximum concurrency reached');
    this.name = 'ConcurrencyLimitError';
  }
}

/** Request object with a JSON body (used by `/invocations`). */
export interface JsonRequestLike extends HttpRequestLike {
  json(): Promise<any>;
}

/** Minimal WebSocket surface used by {@link AgentArtsRuntimeApp._handleWebsocket}. */
export interface WebSocketLike {
  headers?: any;
  signal?: AbortSignal;
  close?(code?: number, reason?: string): void | Promise<void>;
}

/** Book-keeping entry for a running {@link AgentArtsRuntimeApp.asyncTask}. */
export interface AsyncTaskInfo {
  taskId: number;
  name: string;
  startTime: number;
  metadata: Record<string, any> | null;
}

/** Message delivered by {@link WebSocketConnection.receive}. */
export type WebSocketMessage =
  | { type: 'text'; text: string }
  | { type: 'bytes'; bytes: Buffer }
  | { type: 'close'; code: number; reason: string };

// ---------------------------------------------------------------------------
// Response wrappers (Python `JSONResponse` / `Response` / `StreamingResponse`)
// ---------------------------------------------------------------------------

/**
 * Plain HTTP response, the Node counterpart of Starlette's `Response`.
 *
 * Handlers may return an instance from an entrypoint to take full control of
 * the response (status, headers, media type, body).
 */
export class Response {
  /** HTTP status code. */
  statusCode: number;
  /** Raw response body (string or Buffer) for non-streaming responses. */
  body: string | Buffer | null;
  /** Extra response headers. */
  headers: Record<string, string>;
  /** Value of the `content-type` header (charset is added for `text/*`). */
  mediaType: string | null;

  constructor(init?: {
    statusCode?: number;
    content?: string | Buffer | null;
    body?: string | Buffer | null;
    headers?: Record<string, string>;
    mediaType?: string | null;
  }) {
    this.statusCode = init?.statusCode ?? 200;
    this.body = init?.content ?? init?.body ?? null;
    this.headers = { ...(init?.headers ?? {}) };
    this.mediaType = init?.mediaType ?? null;
  }
}

/** JSON response (Python `JSONResponse`), serialised compactly like Starlette. */
export class JsonResponse extends Response {
  constructor(init?: { content?: unknown; statusCode?: number; headers?: Record<string, string> }) {
    const content = init?.content === undefined ? null : init.content;
    super({
      statusCode: init?.statusCode ?? 200,
      content: JSON.stringify(content),
      headers: init?.headers,
      mediaType: 'application/json',
    });
  }
}

/** Chunks accepted by {@link StreamingResponse}. */
export type StreamingContent = Iterable<string | Buffer> | AsyncIterable<string | Buffer>;

/** Streaming response (Python `StreamingResponse`), used for SSE payloads. */
export class StreamingResponse extends Response {
  /** Iterable/async iterable producing the response chunks. */
  readonly contentStream: StreamingContent;

  constructor(
    content: StreamingContent,
    init?: {
      statusCode?: number;
      headers?: Record<string, string>;
      mediaType?: string;
    },
  ) {
    super({
      statusCode: init?.statusCode ?? 200,
      headers: init?.headers,
      mediaType: init?.mediaType ?? 'text/event-stream',
    });
    this.contentStream = content;
  }
}

// `JSONResponse` is the Python spelling; keep it as an alias for parity.
export { JsonResponse as JSONResponse };

// ---------------------------------------------------------------------------
// Request / WebSocket wrappers
// ---------------------------------------------------------------------------

/** Raised when a WebSocket peer disconnects (Python `WebSocketDisconnect`). */
export class WebSocketDisconnect extends Error {
  /** WebSocket close code. */
  code: number;
  /** Close reason, when supplied by the peer. */
  reason: string;

  constructor(code = 1000, reason?: string) {
    super(`WebSocket disconnected (code: ${code}${reason ? `, reason: ${reason}` : ''})`);
    this.name = 'WebSocketDisconnect';
    this.code = code;
    this.reason = reason ?? '';
  }
}

/** Incoming HTTP request exposed to handlers (Python `starlette.requests.Request`). */
export class RuntimeRequest {
  signal?: AbortSignal;
  /** The underlying Node request. */
  readonly raw: IncomingMessage;
  /** HTTP method, e.g. `POST`. */
  readonly method: string;
  /** Full request target, e.g. `/invocations?x=1`. */
  readonly url: string;
  /** Request headers (Node lower-cases the names). */
  readonly headers: IncomingHttpHeaders;
  /** Query string parameters. */
  readonly queryParams: URLSearchParams;
  /** Remote peer, when known. */
  readonly client: { host?: string; port?: number } | null;

  private readonly _bodyText: string;

  constructor(raw: IncomingMessage, bodyText = '') {
    this.raw = raw;
    this.method = raw.method ?? 'GET';
    this.url = raw.url ?? '/';
    this.headers = raw.headers ?? {};
    this.queryParams = new URLSearchParams(
      this.url.includes('?') ? this.url.slice(this.url.indexOf('?') + 1) : '',
    );
    this.client = raw.socket
      ? { host: raw.socket.remoteAddress ?? undefined, port: raw.socket.remotePort ?? undefined }
      : null;
    this._bodyText = bodyText;
  }

  /** Raw request body as UTF-8 text. */
  text(): string {
    return this._bodyText;
  }

  /** Raw request body as bytes (Python `Request.body()`). */
  async body(): Promise<Buffer> {
    return Buffer.from(this._bodyText, 'utf8');
  }

  /**
   * Parse the request body as JSON.
   *
   * Throws a `SyntaxError` when the payload is not valid JSON, which the
   * invocation endpoint turns into a `400 Invalid JSON payload` response.
   */
  async json(): Promise<any> {
    return JSON.parse(this._bodyText);
  }
}

/**
 * WebSocket connection handed to `@app.websocket` handlers.
 *
 * Mirrors the subset of `starlette.websockets.WebSocket` used by the Python
 * runtime, camelCased: `accept`, `receive`, `receiveText`, `receiveBytes`,
 * `receiveJson`, `send`, `sendText`, `sendBytes`, `sendJson`, `close`.
 *
 * `accept()` is recorded for API parity only: with `ws` the HTTP upgrade is
 * completed before the handler runs, so frames may be sent immediately.
 */
export class WebSocketConnection implements WebSocketLike {
  private readonly _cancellation = new AbortController();
  /** Aborted on connection close/error; does not automatically release execution slots. */
  get signal(): AbortSignal {
    return this._cancellation.signal;
  }
  /** The underlying `ws` socket. */
  readonly raw: WsWebSocket;
  /** Headers received with the HTTP upgrade request. */
  readonly headers: IncomingHttpHeaders;
  /** Request path of the connection, normally `/ws`. */
  readonly path: string;
  /** Query string parameters of the upgrade request. */
  readonly queryParams: URLSearchParams;

  private readonly _messages: WebSocketMessage[] = [];
  private readonly _waiters: Array<(message: WebSocketMessage) => void> = [];
  private _accepted = false;
  private _closed = false;
  private _closeCode: number | null = null;
  private _closeReason: string | null = null;

  constructor(init: {
    raw: WsWebSocket;
    headers?: IncomingHttpHeaders;
    path?: string;
    queryParams?: URLSearchParams;
  }) {
    this.raw = init.raw;
    this.headers = init.headers ?? {};
    this.path = init.path ?? '/ws';
    this.queryParams = init.queryParams ?? new URLSearchParams();
    this._attach();
  }

  /** Whether `accept()` has been called. */
  get accepted(): boolean {
    return this._accepted;
  }

  /** Whether the peer (or we) closed the connection. */
  get closed(): boolean {
    return this._closed;
  }

  /** Accept the connection. Kept for API parity; the handshake is already done. */
  async accept(_subprotocol?: string | string[], _headers?: Record<string, string>): Promise<void> {
    this._accepted = true;
  }

  /** Receive the next raw message (`text`, `bytes` or `close`). */
  async receive(): Promise<WebSocketMessage> {
    const queued = this._messages.shift();
    if (queued) {
      return queued;
    }
    if (this._closed) {
      throw new WebSocketDisconnect(this._closeCode ?? 1000, this._closeReason ?? undefined);
    }
    return new Promise<WebSocketMessage>((resolve) => {
      this._waiters.push(resolve);
    });
  }

  /** Receive the next message as text; throws when it is binary or on close. */
  async receiveText(): Promise<string> {
    const message = await this.receive();
    if (message.type === 'close') {
      throw new WebSocketDisconnect(message.code, message.reason);
    }
    if (message.type !== 'text') {
      throw new Error('Expected a text WebSocket message but received bytes');
    }
    return message.text;
  }

  /** Receive the next message as bytes; throws when it is text or on close. */
  async receiveBytes(): Promise<Buffer> {
    const message = await this.receive();
    if (message.type === 'close') {
      throw new WebSocketDisconnect(message.code, message.reason);
    }
    if (message.type !== 'bytes') {
      throw new Error('Expected a binary WebSocket message but received text');
    }
    return message.bytes;
  }

  /** Receive the next message and parse it as JSON (Python `receive_json`). */
  async receiveJson(): Promise<any> {
    return JSON.parse(await this.receiveText());
  }

  /** Send a raw message object. */
  async send(message: WebSocketMessage): Promise<void> {
    switch (message.type) {
      case 'text':
        await this.sendText(message.text);
        return;
      case 'bytes':
        await this.sendBytes(message.bytes);
        return;
      case 'close':
        await this.close(message.code, message.reason);
        return;
      default:
        throw new Error(`Unknown WebSocket message type: ${String((message as any)?.type)}`);
    }
  }

  /** Send a text frame. */
  async sendText(data: string): Promise<void> {
    await this._send(data, false);
  }

  /** Send a binary frame. */
  async sendBytes(data: Buffer): Promise<void> {
    await this._send(data, true);
  }

  /** Serialise `data` to compact JSON and send it as a text frame. */
  async sendJson(data: unknown): Promise<void> {
    await this.sendText(JSON.stringify(data));
  }

  /** Close the connection (Python default code `1000`). */
  async close(code = 1000, reason?: string): Promise<void> {
    if (this._closed) {
      return;
    }
    this._closed = true;
    this._closeCode = code;
    this._closeReason = reason ?? null;
    try {
      this.raw.close(code, reason);
    } catch {
      // Closing an already-closed socket is not an error for callers.
    }
  }

  private _attach(): void {
    this.raw.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) {
        this._dispatch({ type: 'bytes', bytes: toBuffer(data) });
      } else {
        this._dispatch({ type: 'text', text: toBuffer(data).toString('utf8') });
      }
    });
    this.raw.on('close', (code: number, reason: Buffer) => {
      this._cancellation.abort();
      this._closed = true;
      this._closeCode = code;
      this._closeReason = reason ? reason.toString('utf8') : null;
      this._dispatch({ type: 'close', code, reason: this._closeReason ?? '' });
    });
    this.raw.on('error', () => {
      this._cancellation.abort();
      if (this._closed) {
        return;
      }
      this._closed = true;
      this._closeCode = 1011;
      this._closeReason = 'WebSocket error';
      this._dispatch({ type: 'close', code: 1011, reason: 'WebSocket error' });
    });
  }

  private _dispatch(message: WebSocketMessage): void {
    const waiter = this._waiters.shift();
    if (waiter) {
      waiter(message);
      return;
    }
    this._messages.push(message);
  }

  private _send(data: string | Buffer, binary: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this._closed) {
        reject(new WebSocketDisconnect(this._closeCode ?? 1000, this._closeReason ?? undefined));
        return;
      }
      this.raw.send(data, { binary }, (err?: Error) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function errorName(err: unknown): string {
  if (err instanceof Error && err.name) {
    return err.name;
  }
  const ctorName = (err as any)?.constructor?.name;
  if (typeof ctorName === 'string' && ctorName) {
    return ctorName;
  }
  return typeof err;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

function isThenable(value: unknown): value is Promise<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any).then === 'function';
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as any)[Symbol.asyncIterator] === 'function'
  );
}

function isSyncGenerator(value: unknown): value is Iterable<unknown> {
  if (value === null || typeof value !== 'object' || isAsyncIterable(value)) {
    return false;
  }
  return (
    typeof (value as any).next === 'function' && typeof (value as any)[Symbol.iterator] === 'function'
  );
}

function handlerName(handler: unknown): string {
  const name = (handler as any)?.name;
  return typeof name === 'string' && name ? name : 'unknown';
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}

function formatContentType(mediaType: string | null | undefined): string | null {
  if (!mediaType) {
    return null;
  }
  return mediaType.startsWith('text/') ? `${mediaType}; charset=utf-8` : mediaType;
}

function pathOf(url: string | undefined): string {
  if (!url) {
    return '/';
  }
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch {
    const queryIndex = url.indexOf('?');
    return queryIndex === -1 ? url : url.slice(0, queryIndex);
  }
}

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (err) => reject(err));
    req.on('aborted', () => reject(new Error('Request aborted by the client')));
  });
}

function writeChunk(res: ServerResponse, chunk: string | Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    try {
      res.write(chunk, (err?: Error | null) => (err ? reject(err) : resolve()));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Coerce a value into something `JSON.stringify` can always handle.
 *
 * Mirrors Python `json.dumps(obj, default=str)`: values that have no JSON
 * representation fall back to their string form, BigInt values become decimal
 * strings and reference cycles never throw.
 */
function normalizeForJson(value: any, ancestors: Set<unknown>): any {
  if (value === null) {
    return null;
  }
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'boolean' || valueType === 'number') {
    return value;
  }
  if (valueType === 'undefined') {
    return undefined;
  }
  if (valueType === 'bigint') {
    return value.toString();
  }
  if (valueType === 'function' || valueType === 'symbol') {
    return String(value);
  }
  if (valueType !== 'object') {
    return String(value);
  }

  if (ancestors.has(value)) {
    return String(value);
  }

  if (typeof value.toJSON === 'function') {
    let serialized: any;
    try {
      serialized = value.toJSON();
    } catch {
      return String(value);
    }
    if (serialized !== value) {
      return normalizeForJson(serialized, ancestors);
    }
  }

  if (value instanceof Error) {
    return String(value);
  }

  if (value instanceof Map) {
    const result: Record<string, any> = {};
    ancestors.add(value);
    try {
      for (const [key, item] of value) {
        const normalized = normalizeForJson(item, ancestors);
        if (normalized !== undefined) {
          result[String(key)] = normalized;
        }
      }
    } finally {
      ancestors.delete(value);
    }
    return result;
  }

  if (value instanceof Set) {
    const result: any[] = [];
    ancestors.add(value);
    try {
      for (const item of value) {
        const normalized = normalizeForJson(item, ancestors);
        result.push(normalized === undefined ? null : normalized);
      }
    } finally {
      ancestors.delete(value);
    }
    return result;
  }

  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const result: any[] = [];
    ancestors.add(value);
    try {
      for (const item of value as any) {
        const normalized = normalizeForJson(item, ancestors);
        result.push(normalized === undefined ? null : normalized);
      }
    } finally {
      ancestors.delete(value);
    }
    return result;
  }

  const result: Record<string, any> = {};
  ancestors.add(value);
  try {
    for (const key of Object.keys(value)) {
      let item: any;
      try {
        item = value[key];
      } catch {
        item = undefined;
      }
      const normalized = normalizeForJson(item, ancestors);
      if (normalized !== undefined) {
        result[key] = normalized;
      }
    }
  } finally {
    ancestors.delete(value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

/**
 * HTTP/WebSocket application hosting an agent entrypoint.
 *
 * Usage::
 *
 * ```ts
 * const app = new AgentArtsRuntimeApp();
 *
 * const handle = app.entrypoint(async (payload, context) => {
 *   return { result: String(payload?.input ?? '').toUpperCase() };
 * });
 *
 * app.ping(() => PingStatus.HEALTHY);
 *
 * app.websocket(async (ws) => {
 *   await ws.accept();
 *   while (true) {
 *     const data = await ws.receiveJson();
 *     await ws.sendJson({ echo: data });
 *   }
 * });
 *
 * handle.run();
 * ```
 */
export class AgentArtsRuntimeApp {
  /** Registered handlers, keyed by role (`main` for the entrypoint). */
  handlers: Record<string, RuntimeHandler> = {};
  /** Advertised protocol (`'http'` or `'https'`). */
  readonly protocol: 'http' | 'https';
  /** Whether debug mode was requested. */
  readonly debug: boolean;
  /** Shared execution capacity for this application instance. */
  readonly maxConcurrency: number;
  /** Logger (`agentarts.runtime.app`). */
  readonly logger: Logger;

  /** Custom ping handler, if registered. */
  _pingHandler: RuntimePingHandler | null = null;
  /** Custom WebSocket handler, if registered. */
  _wsHandler: RuntimeWebSocketHandler | null = null;
  /** Epoch milliseconds of the last status change. */
  _lastStatusUpdateTime: number;
  /** Last reported status, used to debounce `_lastStatusUpdateTime`. */
  _lastKnownStatus: PingStatus | null = null;
  /** Status forced through {@link forcePingStatus}, if any. */
  _forcePingStatus: PingStatus | null = null;
  /** Registry of running async tasks, keyed by task id. */
  _activeTasks: Map<number, AsyncTaskInfo> = new Map();

  private readonly _lifespan: RuntimeLifespan | null;
  private _nextTaskId = 1;
  private _activeInvocations = 0;
  readonly executions: ExecutionCoordinator;
  private readonly _protocolRoutes = new Map<string, { protocol: RuntimeProtocol; methods: readonly string[] }>();
  private _protocolRequests = 0;
  private readonly _maxProtocolRequests: number;
  private readonly _protocolShutdownHooks = new Set<() => Promise<void>>();

  constructor(options: AgentArtsRuntimeAppOptions = {}) {
    this.debug = options.debug ?? false;
    this.protocol = options.protocol ?? 'http';
    this.maxConcurrency = options.maxConcurrency ?? 15;
    if (!Number.isSafeInteger(this.maxConcurrency) || this.maxConcurrency <= 0) {
      throw new RangeError('maxConcurrency must be a positive safe integer');
    }
    this._lifespan = options.lifespan ?? null;
    this._lastStatusUpdateTime = Date.now();
    this.logger = getLogger('runtime.app');
    this._maxProtocolRequests = boundedInteger(options.maxProtocolRequests ?? 64, 'maxProtocolRequests');
    this.executions = new ExecutionCoordinator(() => this.acquireSlot(), options.executionLimits);
  }

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  /** Register `fn` as the main agent invocation handler. */
  entrypoint<T extends RuntimeHandler>(fn: T): T & { run: RuntimeRunFunction } {
    this.handlers['main'] = fn;
    const run = this.run.bind(this);
    try {
      Object.defineProperty(fn, 'run', {
        value: run,
        writable: true,
        configurable: true,
        enumerable: false,
      });
    } catch {
      (fn as any).run = run;
    }
    return fn as T & { run: RuntimeRunFunction };
  }

  /** Register `fn` as the health-check handler. */
  ping(fn: RuntimePingHandler): RuntimePingHandler {
    this._pingHandler = fn;
    return fn;
  }

  /** Register `fn` as the WebSocket handler. */
  websocket(fn: RuntimeWebSocketHandler): RuntimeWebSocketHandler {
    this._wsHandler = fn;
    return fn;
  }

  /** Mount an optional protocol without importing its dependencies into the base SDK. */
  use(protocol: RuntimeProtocol): this {
    if (!protocol || typeof protocol.handle !== 'function' || !protocol.routes.length) throw new TypeError('Invalid runtime protocol');
    const paths = new Set<string>();
    for (const route of protocol.routes) {
      if (!/^\/(?:[A-Za-z0-9_.~-]+\/)*[A-Za-z0-9_.~-]+$/.test(route.path) ||
          new URL(route.path, 'http://localhost').pathname !== route.path ||
          ['/invocations', '/ping', '/ws'].includes(route.path) ||
          this._protocolRoutes.has(route.path) || paths.has(route.path) || !route.methods.length ||
          route.methods.some(method => !/^(GET|POST|DELETE|OPTIONS)$/.test(method))) {
        throw new Error('Conflicting or invalid protocol route');
      }
      paths.add(route.path);
    }
    for (const route of protocol.routes) this._protocolRoutes.set(route.path, { protocol, methods: [...route.methods] });
    return this;
  }

  /**
   * Acquire a shared execution slot synchronously, or throw ConcurrencyLimitError.
   * WebSocket/protocol handlers acquire once per round, not per connection.
   * HTTP invocations already acquire automatically and must not acquire twice.
   */
  acquireSlot(): SlotLease {
    if (this._activeInvocations >= this.maxConcurrency) throw new ConcurrencyLimitError();
    this._activeInvocations += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this._activeInvocations -= 1;
      },
    };
  }

  /**
   * Register `fn` as a tracked background task.
   *
   * The wrapped function is added to the active-task registry while it runs,
   * which makes `/ping` report `HealthyBusy` and is removed afterwards (also
   * when it rejects). Only async functions are accepted, exactly like Python.
   */
  asyncTask<T extends RuntimeAsyncTaskHandler>(fn: T): RuntimeAsyncTaskFunction<T> {
    if (!isAsyncFunction(fn)) {
      throw new Error('async_task decorator must be used with async functions');
    }
    const app = this;
    const name = handlerName(fn);
    const wrapper = async function (this: unknown, ...args: any[]): Promise<any> {
      const taskId = app._addTask(name);
      try {
        return await fn.apply(this, args);
      } catch (err) {
        app.logger.exception(`Async task ${name} (ID: ${taskId}) error: ${errorMessage(err)}`);
        throw err;
      } finally {
        app._completeTask(taskId);
      }
    };
    Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
    (wrapper as any)._isAsyncTask = true;
    (wrapper as any)._originalFunc = fn;
    return wrapper as unknown as RuntimeAsyncTaskFunction<T>;
  }

  // ------------------------------------------------------------------
  // Task management
  // ------------------------------------------------------------------

  /** Register a new task in the active-task registry and return its id. */
  _addTask(name: string, metadata?: Record<string, any> | null): number {
    const taskId = this._nextTaskId++;
    this._activeTasks.set(taskId, {
      taskId,
      name,
      startTime: Date.now(),
      metadata: metadata ?? null,
    });
    this.logger.debug(`Async task start: ${name}(ID: ${taskId})`);
    return taskId;
  }

  /** Remove `taskId` from the registry; returns `true` when it was present. */
  _completeTask(taskId: number): boolean {
    const removed = this._activeTasks.get(taskId);
    if (removed) {
      this._activeTasks.delete(taskId);
      const duration = (Date.now() - removed.startTime) / 1000;
      this.logger.debug(
        `Async task completed: ${removed.name}(ID: ${taskId}, duration: ${duration.toFixed(3)}s)`,
      );
      return true;
    }
    this.logger.warning(`Async task not found in registry: ${taskId}`);
    return false;
  }

  /** Whether at least one async task is currently running. */
  hasRunningTasks(): boolean {
    return this._activeTasks.size > 0;
  }

  // ------------------------------------------------------------------
  // Request context helpers
  // ------------------------------------------------------------------

  /**
   * Populate {@link AgentArtsRuntimeContext} from the request headers and build
   * the {@link RequestContext} handed to handlers.
   *
   * Header names are matched case-insensitively; `X-Request-Id` falls back to a
   * fresh UUID.
   */
  _buildRequestContext(request: HttpRequestLike): RequestContext {
    const headers = request?.headers ?? {};

    const workloadAccessToken = this._readHeader(headers, ACCESS_TOKEN_HEADER);
    if (workloadAccessToken) {
      AgentArtsRuntimeContext.setWorkloadAccessToken(workloadAccessToken);
    }

    const sessionId = this._readHeader(headers, SESSION_HEADER);
    if (sessionId) {
      AgentArtsRuntimeContext.setSessionId(sessionId);
    }

    const userId = this._readHeader(headers, USER_ID_HEADER);
    if (userId) {
      AgentArtsRuntimeContext.setUserId(userId);
    }

    const requestId = this._readHeader(headers, 'X-Request-Id') ?? randomUUID();
    AgentArtsRuntimeContext.setRequestId(requestId);

    return new RequestContext({
      sessionId,
      requestId,
      request,
      signal: request.signal,
    });
  }

  /**
   * Whether `handler` accepts a `context` as its second positional parameter
   * (Python `_task_context`).
   */
  _taskContext(handler: RuntimeHandler): boolean {
    const params = this._parameterNames(handler);
    return params.length >= 2 && params[1] === 'context';
  }

  /**
   * Whether `handler` accepts a `context` as its first positional parameter
   * (Python `_ping_task_context`).
   */
  _pingTaskContext(handler: RuntimePingHandler): boolean {
    const params = this._parameterNames(handler);
    return params.length >= 1 && params[0] === 'context';
  }

  // ------------------------------------------------------------------
  // Invocation endpoint
  // ------------------------------------------------------------------

  /** Handle `POST /invocations`. */
  async _handleInvocation(request: JsonRequestLike): Promise<Response> {
    return AgentArtsRuntimeContext.runInNewContext(async () => {
      const startTime = Date.now();

      try {
        let payload: any;
        try {
          payload = await request.json();
        } catch (err) {
          const duration = (Date.now() - startTime) / 1000;
          this.logger.warning(
            `Invalid JSON payload after ${duration.toFixed(3)} s: ${errorMessage(err)}`,
          );
          return new JsonResponse({
            statusCode: 400,
            content: { error: 'Invalid JSON payload', message: errorMessage(err) },
          });
        }

        this.logger.debug('Processing invocation request');

        const handler = this.handlers['main'];
        if (!handler) {
          return new JsonResponse({ statusCode: 404, content: { error: 'No entrypoint defined' } });
        }

        const requestContext = this._buildRequestContext(request);
        const taskContext = this._taskContext(handler);
        this.logger.debug(`Invoking handler ${handlerName(handler)}`);

        const result = await this._invokeHandler(handler, requestContext, taskContext, payload);
        const duration = (Date.now() - startTime) / 1000;

        if (result instanceof Response) {
          this.logger.debug(
            `Returning predefined response type ${result.constructor?.name ?? 'Response'}`,
          );
          return result;
        }

        this.logger.info(`Invocation completed (${duration.toFixed(3)} s)`);
        const safeJsonString = this._safeSerializeToJsonString(result);
        return new Response({
          statusCode: 200,
          content: safeJsonString,
          headers: { [SESSION_HEADER]: requestContext.sessionId ?? '' },
          mediaType: 'application/json',
        });
      } catch (err) {
        const duration = (Date.now() - startTime) / 1000;
        this.logger.exception(
          `Invocation failed after ${duration.toFixed(3)} s: ${errorName(err)}: ${errorMessage(err)}`,
        );
        return new JsonResponse({
          statusCode: 500,
          content: { error: errorName(err), message: errorMessage(err) },
        });
      } finally {
        AgentArtsRuntimeContext.clear();
      }
    });
  }

  /**
   * Execute `handler` while respecting the concurrency limit.
   *
   * Returns a `503 Service Busy` response when the limit is already reached,
   * mirroring Python's `Semaphore.locked()` short-circuit.
   */
  async _invokeHandler(
    handler: RuntimeHandler,
    requestContext: RequestContext,
    taskContext: boolean,
    payload: any,
  ): Promise<any> {
    let lease: SlotLease;
    try {
      lease = this.acquireSlot();
    } catch (err) {
      if (!(err instanceof ConcurrencyLimitError)) throw err;
      return new JsonResponse({
        statusCode: 503,
        content: { error: 'Service busy - maximum concurrency reached' },
      });
    }

    let transferred = false;
    try {
      const result = taskContext ? await handler(payload, requestContext) : await handler(payload);
      if (result instanceof StreamingResponse) {
        const response = new StreamingResponse(retainSlot(result.contentStream, lease), {
          statusCode: result.statusCode,
          headers: result.headers,
          mediaType: result.mediaType ?? undefined,
        });
        // null explicitly disables the automatically generated Content-Type.
        response.mediaType = result.mediaType;
        transferred = true;
        return response;
      } else if (isSyncGenerator(result) || isAsyncIterable(result)) {
        const sync = isSyncGenerator(result);
        const stream = retainSlot(result, lease, value => this._convertToSse(value), (error, cleanupFailure) => {
          this.logger.exception(`${sync ? 'Sync' : 'Async'} stream error: ${errorName(error)}: ${errorMessage(error)}`);
          if (cleanupFailure) {
            this.logger.exception(`Stream cleanup failed: ${errorName(cleanupFailure.error)}: ${errorMessage(cleanupFailure.error)}`);
          }
          return this._convertToSse({
            error: errorMessage(error),
            error_type: errorName(error),
            message: `Error occurred during ${sync ? 'sync' : 'async'} stream generation`,
          });
        });
        const response = new StreamingResponse(stream);
        transferred = true;
        return response;
      }
      return result;
    } catch (err) {
      this.logger.exception(
        `Handler '${handlerName(handler)}' execution failed: ${errorName(err)}: ${errorMessage(err)}`,
      );
      throw err;
    } finally {
      if (!transferred) lease.release();
    }
  }

  // ------------------------------------------------------------------
  // Serialization
  // ------------------------------------------------------------------

  /**
   * Serialise `obj` to JSON with Python-like tolerant fallbacks.
   *
   * Unserialisable values become their string form (`default=str`), BigInt
   * becomes a decimal string and reference cycles are stringified instead of
   * throwing, so a response is never a 500 because of serialisation.
   */
  _safeSerializeToJsonString(obj: any): string {
    try {
      const normalized = normalizeForJson(obj, new Set());
      return JSON.stringify(normalized === undefined ? null : normalized) ?? 'null';
    } catch {
      try {
        return JSON.stringify(String(obj));
      } catch (fallbackErr) {
        this.logger.exception(
          `JSON serialization failed, falling back to str: ${errorMessage(fallbackErr)}: ${errorName(fallbackErr)}`,
        );
        return JSON.stringify({
          error: 'Serialization failed',
          message: errorMessage(fallbackErr),
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Stream generators
  // ------------------------------------------------------------------

  /** Wrap a synchronous generator into an SSE chunk stream. */
  *_syncStreamHandler(gen: Iterable<unknown>): Generator<string> {
    try {
      for (const chunk of gen) {
        yield this._convertToSse(chunk);
      }
    } catch (err) {
      this.logger.exception(`Sync stream error: ${errorName(err)}: ${errorMessage(err)}`);
      yield this._convertToSse({
        error: errorMessage(err),
        error_type: errorName(err),
        message: 'Error occurred during sync stream generation',
      });
    }
  }

  /** Wrap an async generator into an SSE chunk stream. */
  async *_asyncStreamHandler(agen: AsyncIterable<unknown>): AsyncGenerator<string> {
    try {
      for await (const chunk of agen) {
        yield this._convertToSse(chunk);
      }
    } catch (err) {
      this.logger.exception(`Async stream error: ${errorName(err)}: ${errorMessage(err)}`);
      yield this._convertToSse({
        error: errorMessage(err),
        error_type: errorName(err),
        message: 'Error occurred during async stream generation',
      });
    }
  }

  /** Format one value as an SSE `data:` frame (Python `_convert_to_sse`). */
  _convertToSse(obj: unknown): string {
    return `data: ${this._safeSerializeToJsonString(obj)}\n\n`;
  }

  // ------------------------------------------------------------------
  // Ping / health-check endpoint
  // ------------------------------------------------------------------

  /** Handle `GET /ping`. */
  async _handlePing(request: HttpRequestLike): Promise<Response> {
    try {
      const requestContext = this._buildRequestContext(request);
      const status = await this._getCurrentPingStatusAsync(requestContext);
      this.logger.debug(`Ping request - status: ${status}`);
      return new JsonResponse({
        content: {
          status,
          time_of_last_update: Math.trunc(this._lastStatusUpdateTime / 1000),
        },
      });
    } catch (err) {
      this.logger.exception(`Ping handler failed: ${errorName(err)}: ${errorMessage(err)}`);
      return new JsonResponse({
        content: {
          status: PingStatus.UNHEALTHY,
          time_of_last_update: Math.trunc(this._lastStatusUpdateTime / 1000),
        },
      });
    }
  }

  /**
   * Get the current runtime status synchronously.
   *
   * Resolution order (highest priority first): forced status, custom ping
   * handler result (unwrapped - a promise is treated as an invalid status, as
   * in Python), then `HealthyBusy` while async tasks run, otherwise `Healthy`.
   * A non-forced Healthy result becomes HealthyBusy when execution slots are full.
   * Async ping handlers are supported by the HTTP endpoint through
   * {@link _handlePing}.
   */
  getCurrentPingStatus(requestContext?: RequestContext | null): PingStatus {
    let currentStatus: PingStatus | null = this._forcePingStatus;

    if (currentStatus === null && this._pingHandler !== null) {
      currentStatus = this._evaluatePingHandler(requestContext ?? null);
    }

    if (currentStatus === null) {
      currentStatus = this.hasRunningTasks() ? PingStatus.HEALTHY_BUSY : PingStatus.HEALTHY;
    }

    currentStatus = this._applyCapacityStatus(currentStatus);
    this._recordStatus(currentStatus);
    return currentStatus;
  }

  /**
   * Run the custom ping handler and validate its result (sync form).
   *
   * Any failure - raised exception, unknown status string or invalid return
   * type - fails safe to `Unhealthy`.
   */
  _evaluatePingHandler(requestContext: RequestContext | null): PingStatus {
    const handler = this._pingHandler;
    if (handler === null) {
      return PingStatus.UNHEALTHY;
    }

    let result: unknown;
    try {
      result = this._pingTaskContext(handler) ? handler(requestContext) : handler();
    } catch (err) {
      this.logger.exception(`Custom ping handler raised: ${errorName(err)}`);
      return PingStatus.UNHEALTHY;
    }

    if (isThenable(result)) {
      this.logger.error(
        'Custom ping handler returned a promise; only the HTTP /ping endpoint awaits async handlers',
      );
      return PingStatus.UNHEALTHY;
    }

    return this._coercePingStatus(result);
  }

  /**
   * Force a ping status (graceful shutdown / maintenance mode).
   *
   * While set it takes precedence over the custom ping handler; pass `null` to
   * resume normal resolution.
   */
  forcePingStatus(status: PingStatus | null): void {
    this._forcePingStatus = status;
    this._lastStatusUpdateTime = Date.now();
    this._lastKnownStatus = status;
  }

  // ------------------------------------------------------------------
  // WebSocket endpoint
  // ------------------------------------------------------------------

  /**
   * Handle an incoming WebSocket connection.
   *
   * A registered `@app.websocket` handler owns the full lifecycle. Without a
   * handler the connection is closed with code `1011`, matching Python.
   */
  async _handleWebsocket(websocket: WebSocketLike): Promise<void> {
    const requestContext = this._buildRequestContext(websocket);
    try {
      const handler = this._wsHandler;
      if (!handler) {
        this.logger.error('No WebSocket handler registered. Default echo handler used.');
        await websocket.close?.(1011);
        return;
      }
      this.logger.debug('WebSocket connection accepted');
      await handler(websocket as WebSocketConnection, requestContext);
    } catch (err) {
      if (err instanceof WebSocketDisconnect || (err as any)?.name === 'WebSocketDisconnect') {
        this.logger.debug('WebSocket connection closed');
        return;
      }
      this.logger.exception(`WebSocket handler failed: ${errorName(err)}: ${errorMessage(err)}`);
      try {
        await websocket.close?.(1011);
      } catch (closeErr) {
        this.logger.exception(
          `WebSocket connection close failed: ${errorName(closeErr)}: ${errorMessage(closeErr)}`,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Server lifecycle
  // ------------------------------------------------------------------

  /**
   * Start the HTTP server and return it.
   *
   * Resolution follows the Python `run()`:
   * - port: the `port` argument, else `process.env.PORT`, else `8080`;
   * - host: the `host` argument, else `AGENTARTS_BIND_IP`, else `process.env.HOST`,
   *   else the container IPv4 when running in Docker/Kubernetes (falling back to
   *   `0.0.0.0`), else `127.0.0.1`.
   *
   * Attached to the entrypoint function by {@link entrypoint}, so users can do
   * `handler.run('0.0.0.0', 8080)`.
   */
  run(host?: string | null, port?: number): Server {
    const listenHost = this._resolveHost(host ?? null);
    const listenPort = port ?? this._resolvePort();

    const server = http.createServer((req, res) => {
      void this._handleHttpRequest(req, res);
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(wss, req, socket, head);
    });

    server.on('close', () => {
      try {
        wss.close();
      } catch (err) {
        this.logger.debug(`WebSocket server close failed: ${errorMessage(err)}`);
      }
      void this._shutdown();
    });

    this.logger.info(
      `Starting AgentArts runtime on ${listenHost}:${listenPort} (${this.protocol})`,
    );
    server.listen(listenPort, listenHost, () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        this.logger.info(
          `AgentArts runtime listening on ${address.address}:${address.port} (${this.protocol})`,
        );
      }
    });

    void this._startup();
    return server;
  }

  // ------------------------------------------------------------------
  // Private: HTTP plumbing
  // ------------------------------------------------------------------

  private async _handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = pathOf(req.url);
    const cancellation = new AbortController();
    const cancel = () => cancellation.abort();
    req.once('aborted', cancel);
    res.once('close', cancel);
    try {
      const mounted = this._protocolRoutes.get(pathname);
      if (mounted) {
        // Aborted request bodies may emit a later ECONNRESET after a parser has
        // removed its listeners. Keep an observer until IncomingMessage closes.
        const observeRequestError = () => {};
        req.on('error', observeRequestError);
        req.once('close', () => req.off('error', observeRequestError));
        if (!mounted.methods.includes(req.method ?? 'GET')) {
          await this._writeResponse(res, new JsonResponse({ statusCode: 405, content: { error: 'METHOD_NOT_ALLOWED' }, headers: { allow: mounted.methods.join(', ') } }));
          return;
        }
        if (this._protocolRequests >= this._maxProtocolRequests) {
          await this._writeResponse(res, new JsonResponse({ statusCode: 503, content: { error: 'PROTOCOL_CAPACITY' }, headers: { connection: 'close' } }));
          return;
        }
        this._protocolRequests++;
        try {
          let response: Response;
          try {
            response = await AgentArtsRuntimeContext.runInNewContext(() => mounted.protocol.handle(
              makeProtocolRequest(req, pathname, cancellation.signal), { executions: this.executions, logger: this.logger, acquireSlot: () => this.acquireSlot() },
            ));
          } catch (error) {
            // Never reflect provider/SDK exception messages or stack traces.
            const known = error instanceof ProtocolHttpError;
            response = new JsonResponse({ statusCode: known ? error.status : 500,
              content: { error: known ? error.code : 'INTERNAL_ERROR' }, headers: { ...(known ? error.headers : {}), connection: 'close' } });
          }
          if (!req.complete) response.headers.connection = 'close';
          await this._writeResponse(res, response);
        } finally { this._protocolRequests--; }
        return;
      }
      if (pathname === '/invocations') {
        if (req.method !== 'POST') {
          await this._writeResponse(
            res,
            new Response({
              statusCode: 405,
              content: 'Method Not Allowed',
              headers: { allow: 'POST' },
              mediaType: 'text/plain',
            }),
          );
          return;
        }
        const bodyText = await readRequestBody(req);
        const request = new RuntimeRequest(req, bodyText);
        request.signal = cancellation.signal;
        if (req.aborted || res.destroyed) cancellation.abort();
        const response = await this._handleInvocation(request);
        await this._writeResponse(res, response);
        return;
      }

      if (pathname === '/ping') {
        if (req.method !== 'GET') {
          await this._writeResponse(
            res,
            new Response({
              statusCode: 405,
              content: 'Method Not Allowed',
              headers: { allow: 'GET' },
              mediaType: 'text/plain',
            }),
          );
          return;
        }
        const response = await this._handlePing(new RuntimeRequest(req, ''));
        await this._writeResponse(res, response);
        return;
      }

      await this._writeResponse(
        res,
        new Response({ statusCode: 404, content: 'Not Found', mediaType: 'text/plain' }),
      );
    } catch (err) {
      this.logger.exception(`Unhandled request error: ${errorName(err)}: ${errorMessage(err)}`);
      if (res.headersSent || res.writableEnded) {
        res.end();
        return;
      }
      try {
        await this._writeResponse(
          res,
          new JsonResponse({
            statusCode: 500,
            content: { error: errorName(err), message: errorMessage(err) },
          }),
        );
      } catch {
        res.destroy();
      }
    } finally {
      req.off('aborted', cancel);
      res.off('close', cancel);
    }
  }

  private _handleUpgrade(
    wss: WebSocketServer,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const pathname = pathOf(req.url);

    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!this._wsHandler) {
      this.logger.error('No WebSocket handler registered. Rejecting WebSocket upgrade.');
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }

    const url = new URL(req.url ?? '/ws', 'http://localhost');
    wss.handleUpgrade(req, socket, head, (raw) => {
      const connection = new WebSocketConnection({
        raw,
        headers: req.headers,
        path: pathname,
        queryParams: url.searchParams,
      });
      void AgentArtsRuntimeContext.runInNewContext(async () => {
        try {
          await this._handleWebsocket(connection);
        } finally {
          // Python tears the connection down when the ASGI app returns.
          if (!connection.closed) {
            try {
              await connection.close(1000);
            } catch (err) {
              this.logger.debug(`WebSocket session teardown failed: ${errorMessage(err)}`);
            }
          }
        }
      }).catch((err) => {
        this.logger.exception(`WebSocket session failed: ${errorName(err)}: ${errorMessage(err)}`);
      });
    });
  }

  private _setResponseHeaders(res: ServerResponse, response: Response): void {
    res.statusCode = response.statusCode;

    for (const [name, value] of Object.entries(response.headers ?? {})) {
      if (value === undefined || value === null) {
        continue;
      }
      try {
        res.setHeader(name, value);
      } catch (err) {
        this.logger.debug(`Skipping invalid response header '${name}': ${errorMessage(err)}`);
      }
    }

    const contentType = formatContentType(response.mediaType);
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
  }

  private async _writeResponse(res: ServerResponse, response: Response): Promise<void> {
    if (response instanceof StreamingResponse) {
      const iterator = streamIterator(response.contentStream);
      let cleanup: Promise<unknown> | undefined;
      let completed = false;
      const close = () => {
        cleanup ??= Promise.resolve().then(() => iterator.return?.());
        // Observe immediately, then await cleanup in finally before returning.
        void cleanup.catch(() => {});
      };
      res.once('close', close);
      try {
        if (res.writableEnded || res.destroyed) return;
        // Header/status initialization is part of the stream's ownership scope.
        this._setResponseHeaders(res, response);
        while (!res.destroyed && !res.writableEnded) {
          const chunk = await iterator.next();
          if (chunk.done || res.destroyed || res.writableEnded) break;
          await writeChunk(res, chunk.value);
        }
        completed = true;
      } finally {
        close();
        try {
          await cleanup;
        } finally {
          res.off('close', close);
          // Leave an unstarted failed response available for the outer 500 handler.
          if ((completed || res.headersSent) && !res.writableEnded && !res.destroyed) res.end();
        }
      }
      return;
    }

    if (res.writableEnded || res.destroyed) return;
    this._setResponseHeaders(res, response);
    const body = response.body ?? '';
    res.setHeader(
      'content-length',
      String(Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body)),
    );
    res.end(body);
  }

  // ------------------------------------------------------------------
  // Private: ping resolution
  // ------------------------------------------------------------------

  private async _getCurrentPingStatusAsync(
    requestContext: RequestContext | null,
  ): Promise<PingStatus> {
    let currentStatus: PingStatus | null = this._forcePingStatus;

    if (currentStatus === null && this._pingHandler !== null) {
      currentStatus = await this._evaluatePingHandlerAsync(requestContext);
    }

    if (currentStatus === null) {
      currentStatus = this.hasRunningTasks() ? PingStatus.HEALTHY_BUSY : PingStatus.HEALTHY;
    }

    currentStatus = this._applyCapacityStatus(currentStatus);
    this._recordStatus(currentStatus);
    return currentStatus;
  }

  private _applyCapacityStatus(status: PingStatus): PingStatus {
    if (
      this._forcePingStatus === null &&
      status === PingStatus.HEALTHY &&
      this._activeInvocations >= this.maxConcurrency
    )
      return PingStatus.HEALTHY_BUSY;
    return status;
  }

  private async _evaluatePingHandlerAsync(
    requestContext: RequestContext | null,
  ): Promise<PingStatus> {
    const handler = this._pingHandler;
    if (handler === null) {
      return PingStatus.UNHEALTHY;
    }

    let result: unknown;
    try {
      result = this._pingTaskContext(handler) ? handler(requestContext) : handler();
      result = await result;
    } catch (err) {
      this.logger.exception(`Custom ping handler raised: ${errorName(err)}`);
      return PingStatus.UNHEALTHY;
    }

    return this._coercePingStatus(result);
  }

  private _coercePingStatus(result: unknown): PingStatus {
    if (typeof result === 'string') {
      const status = toPingStatus(result);
      if (status !== undefined) {
        return status;
      }
      this.logger.exception(`Custom ping handler returned unknown status: ${String(result)}`);
      return PingStatus.UNHEALTHY;
    }

    this.logger.error(`Custom ping handler returned invalid status: ${String(result)}`);
    return PingStatus.UNHEALTHY;
  }

  private _recordStatus(status: PingStatus): void {
    if (this._lastKnownStatus !== status) {
      this._lastKnownStatus = status;
      this._lastStatusUpdateTime = Date.now();
    }
  }

  // ------------------------------------------------------------------
  // Private: header / signature helpers
  // ------------------------------------------------------------------

  private _readHeader(headers: any, name: string): string | null {
    if (!headers) {
      return null;
    }

    const lowerName = name.toLowerCase();
    let value: any;

    if (typeof headers.get === 'function') {
      value = headers.get(name);
      if (value === undefined || value === null) {
        value = headers.get(lowerName);
      }
    } else {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === lowerName) {
          value = headers[key];
          break;
        }
      }
    }

    if (Array.isArray(value)) {
      value = value[0];
    }
    if (value === undefined || value === null) {
      return null;
    }
    return String(value);
  }

  /**
   * Best-effort parameter names of `handler` (Python `inspect.signature`).
   *
   * Falls back to positional placeholders when the source cannot be inspected,
   * so a handler is only treated as context-aware when it really names the
   * parameter `context`.
   */
  private _parameterNames(handler: unknown): string[] {
    const parsed = parseParameterNames(handler);
    if (parsed !== null) {
      return parsed;
    }
    const arity = typeof (handler as any)?.length === 'number' ? (handler as any).length : 0;
    return Array.from({ length: arity }, (_unused, index) => `arg${index}`);
  }

  // ------------------------------------------------------------------
  // Private: host / port resolution & lifespan
  // ------------------------------------------------------------------

  private _resolveHost(host: string | null): string {
    if (host) {
      return host;
    }

    const envBindIp = process.env.AGENTARTS_BIND_IP;
    if (envBindIp) {
      return envBindIp;
    }

    const envHost = process.env.HOST;
    if (envHost) {
      return envHost;
    }

    if (this._isContainerEnvironment()) {
      return this._getContainerIp() ?? '0.0.0.0';
    }

    return '127.0.0.1';
  }

  private _resolvePort(): number {
    const envPort = Number.parseInt(process.env.PORT ?? '', 10);
    if (Number.isFinite(envPort) && envPort > 0) {
      return envPort;
    }
    return 8080;
  }

  private _isContainerEnvironment(): boolean {
    if (existsSync('/.dockerenv')) {
      return true;
    }
    if (process.env.DOCKER_CONTAINER) {
      return true;
    }
    if (process.env.KUBERNETES_SERVICE_HOST) {
      return true;
    }
    try {
      const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
      if (/docker|kubepods|containerd/.test(cgroup)) {
        return true;
      }
    } catch {
      // Not running on Linux / no permission: not a container signal.
    }
    try {
      const mountinfo = readFileSync('/proc/self/mountinfo', 'utf8');
      if (/docker|containers/.test(mountinfo)) {
        return true;
      }
    } catch {
      // Same as above.
    }
    return false;
  }

  private _getContainerIp(): string | null {
    try {
      const interfaces = networkInterfaces();
      const preferred = ['eth0', ...Object.keys(interfaces).filter((name) => name !== 'eth0')];
      for (const name of preferred) {
        for (const info of interfaces[name] ?? []) {
          if (!info.internal && info.family === 'IPv4') {
            return info.address;
          }
        }
      }
    } catch (err) {
      this.logger.debug(`Failed to detect container IP: ${errorMessage(err)}`);
    }
    return null;
  }

  private async _startup(): Promise<void> {
    const lifespan = this._lifespan;
    if (!lifespan?.onStartup) {
      return;
    }
    try {
      await lifespan.onStartup();
    } catch (err) {
      this.logger.exception(`Lifespan startup failed: ${errorName(err)}: ${errorMessage(err)}`);
    }
  }

  private async _shutdown(): Promise<void> {
    try {
      await this.shutdown();
    } catch (err) {
      this.logger.exception(`Protocol shutdown failed: ${errorName(err)}: ${errorMessage(err)}`);
    }
    const lifespan = this._lifespan;
    if (!lifespan?.onShutdown) {
      return;
    }
    try {
      await lifespan.onShutdown();
    } catch (err) {
      this.logger.exception(`Lifespan shutdown failed: ${errorName(err)}: ${errorMessage(err)}`);
    }
  }

  /** Cancel mounted protocol executions and wait for their actual cleanup. */
  async shutdown(): Promise<void> {
    const protocols = new Set([...this._protocolRoutes.values()].map(route => route.protocol));
    const cleanup = [
      () => this.executions.shutdown(),
      ...[...protocols].map(protocol => () => protocol.shutdown?.()),
      ...this._protocolShutdownHooks,
    ];
    const results = await Promise.allSettled(cleanup.map(async handler => handler()));
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length === 1) throw failures[0]!.reason;
    if (failures.length > 1) {
      throw new AggregateError(failures.map(result => result.reason), 'Protocol shutdown failed');
    }
  }

  /** Register external protocol transports in the same application shutdown lifecycle. */
  onProtocolShutdown(handler: () => Promise<void>): () => void {
    this._protocolShutdownHooks.add(handler);
    return () => { this._protocolShutdownHooks.delete(handler); };
  }
}

/** Signature of the `run` method attached to entrypoints. */
export type RuntimeRunFunction = (host?: string | null, port?: number) => Server;

// ---------------------------------------------------------------------------
// Function introspection helpers
// ---------------------------------------------------------------------------

function isAsyncFunction(fn: unknown): boolean {
  if (typeof fn !== 'function') {
    return false;
  }
  return (
    Object.prototype.toString.call(fn) === '[object AsyncFunction]' ||
    (fn as any)?.constructor?.name === 'AsyncFunction' ||
    (fn as any)?.[Symbol.toStringTag] === 'AsyncFunction'
  );
}

/**
 * Extract parameter names from a function source.
 *
 * Returns `null` when the source cannot be inspected (native code, proxies),
 * so the caller can fall back to the declared arity.
 */
function parseParameterNames(handler: unknown): string[] | null {
  if (typeof handler !== 'function') {
    return null;
  }

  let source: string;
  try {
    source = Function.prototype.toString.call(handler);
  } catch {
    return null;
  }

  if (!source || source.includes('[native code]')) {
    return null;
  }

  let paramsText: string | null = null;
  const signature = /^[^(]*\(([^)]*)\)/.exec(source);
  if (signature) {
    paramsText = signature[1];
  } else {
    const singleParam = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/.exec(source);
    if (singleParam) {
      paramsText = singleParam[1];
    }
  }

  if (paramsText === null) {
    return null;
  }

  return paramsText
    .split(',')
    .map((param) =>
      param
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
        .split('=')[0]
        .replace(/^\.\.\./, '')
        .trim(),
    )
    .filter((param) => param.length > 0);
}

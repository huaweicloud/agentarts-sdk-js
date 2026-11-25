/**
 * AgentArts Runtime Client.
 *
 * Mirrors `agentarts/sdk/service/runtime_client.py`.
 *
 * Provides a high-level client for interacting with the AgentArts control
 * plane and data plane APIs.
 *
 * The client is divided into two logical groups:
 *
 * - **Control Plane** – agent and endpoint lifecycle management
 *   (create, update, delete, query agents and endpoints).
 * - **Data Plane** – runtime invocation (invoke an agent), command execution,
 *   file upload/download and session management.
 *
 * Usage:
 *
 * ```ts
 * const client = new RuntimeClient();
 *
 * // Control plane
 * const agent = await client.createAgent('my-agent', { description: 'A test agent' });
 * const agents = await client.getAgents();
 *
 * // Data plane
 * const result = await client.invokeAgent('my-agent', 'session-1', JSON.stringify({ input: 'hello' }));
 *
 * // Local runtime
 * const localClient = new LocalRuntimeClient(8080);
 * const invoked = await localClient.invokeAgent(JSON.stringify({ input: 'hello' }));
 * const health = await localClient.pingAgent();
 * ```
 *
 * Streaming responses (`text/event-stream`, `application/x-ndjson`) are exposed
 * as `AsyncGenerator<string>` instead of Python's `Iterator[str]`; use
 * `for await (const event of result)` to consume them.
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { Agent } from 'undici';

import { SESSION_HEADER, USER_ID_HEADER } from '../runtime/model.js';
import { getControlPlaneEndpoint, getRuntimeDataPlaneEndpoint } from '../utils/constant.js';
import { getLogger } from '../utils/logging.js';
import { appendQueryParams } from '../utils/query.js';
import { buildUserAgent } from '../utils/user-agent.js';
import {
  BaseHTTPClient,
  RequestConfig,
  RequestResult,
  SignMode,
  type RequestOptions,
} from './http-client.js';

const log = getLogger('sdk.service.runtime_client');

/** Offset of the `ustar` magic inside a tar header. */
const _TAR_MAGIC_OFFSET = 257;
/** `ustar` magic bytes identifying an uncompressed tar archive. */
const _TAR_MAGIC = Buffer.from('ustar', 'utf8');

/** Content types whose response body is a downloadable byte stream. */
const _STREAM_RESPONSE_TYPES = ['application/octet-stream', 'application/x-tar'];

/** Maximum accepted upload size (100 MB), same as Python. */
const _MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Return `true` when a value was provided (mirrors Python's `is not None`);
 * `undefined` and `null` are both treated as "not set".
 */
function _present(value: any): boolean {
  return value !== undefined && value !== null;
}

/** Return the value as a plain object when it is one, otherwise `null`. */
function _asDict(data: any): Record<string, any> | null {
  if (_present(data) && typeof data === 'object' && !Array.isArray(data) && !ArrayBuffer.isView(data)) {
    return data as Record<string, any>;
  }
  return null;
}

/** Case-insensitive header lookup (fetch lowercases header names). */
function _headerValue(headers: Record<string, string> | null | undefined, name: string): string {
  if (!headers) {
    return '';
  }
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) {
      return value ?? '';
    }
  }
  return '';
}

/** Render a value for a log message (Python uses `%s`). */
function _formatValue(value: any): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return 'undefined';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}



/**
 * Detect a tar payload by `.tar` suffix or the `ustar` magic at offset 257.
 *
 * The backend serves tar uploads on a dedicated `application/x-tar` channel.
 * Sending a tar with `application/octet-stream` makes the gateway tear the
 * connection down before the server can emit a clean error, which surfaces as
 * a low-level SSL error rather than the real business error (e.g. "no session").
 *
 * @param localFile Local file path.
 * @param content In-memory payload (string or bytes).
 * @param filename Filename hint used when no path/content is given.
 */
export function isTarPayload(
  localFile: string | null = null,
  content: any = null,
  filename: string | null = null,
): boolean {
  const name = localFile || filename || '';
  if (name.toLowerCase().endsWith('.tar')) {
    return true;
  }

  // Inspect the ustar magic at offset 257. For an in-memory payload we already
  // hold the bytes; for a local file we read only the 5 magic bytes to avoid
  // slurping a large file into memory.
  let payload = content;
  if (!_present(payload) && localFile) {
    try {
      const fd = openSync(localFile, 'r');
      try {
        const buffer = Buffer.alloc(_TAR_MAGIC.length);
        const bytesRead = readSync(fd, buffer, 0, _TAR_MAGIC.length, _TAR_MAGIC_OFFSET);
        return bytesRead === _TAR_MAGIC.length && buffer.subarray(0, bytesRead).equals(_TAR_MAGIC);
      } finally {
        closeSync(fd);
      }
    } catch {
      return false;
    }
  }

  if (typeof payload === 'string') {
    payload = Buffer.from(payload, 'utf8');
  }
  if (payload instanceof Uint8Array && payload.length >= _TAR_MAGIC_OFFSET + _TAR_MAGIC.length) {
    return Buffer.from(
      payload.subarray(_TAR_MAGIC_OFFSET, _TAR_MAGIC_OFFSET + _TAR_MAGIC.length),
    ).equals(_TAR_MAGIC);
  }
  return false;
}

/** Content-Type the data plane expects for an upload payload. */
export function uploadContentType(
  localFile: string | null = null,
  content: any = null,
  filename: string | null = null,
): string {
  return isTarPayload(localFile, content, filename)
    ? 'application/x-tar'
    : 'application/octet-stream';
}

/**
 * `BaseHTTPClient` subclass that exposes the request pipeline this module
 * needs: forced streaming responses and raw binary request bodies.
 */
class RuntimeHTTPClient extends BaseHTTPClient {
  private _tlsDispatcher?: Agent;

  /**
   * Execute a request.
   *
   * Query parameters are serialized into the URL by `BaseHTTPClient._request`
   * only, using the same RFC 3986 encoding the signers apply to the canonical
   * request. Appending them here as well would put every parameter on the wire
   * twice while signing it once, which makes the gateway reject the signature.
   */
  async send(method: string, url: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._request(method, url, options);
  }

  /**
   * Send a raw binary body.
   *
   * `BaseHTTPClient` serializes every object body as form parameters, which
   * cannot carry arbitrary bytes, so binary payloads go straight to `fetch`
   * while reusing the same signing, default headers, timeout and TLS settings.
   */
  async sendBinary(
    method: string,
    url: string,
    body: Uint8Array,
    options: RequestOptions = {},
  ): Promise<RequestResult> {
    const { params, ...rest } = options;
    const fullUrl = `${this._config.baseUrl}${appendQueryParams(url, params)}`;

    const defaultHeaders: Record<string, string> = {
      'User-Agent': buildUserAgent(this._config.headers['User-Agent'] ?? ''),
      ...this._config.headers,
    };

    let working: RequestOptions = {
      ...rest,
      headers: { ...defaultHeaders, ...(rest.headers ?? {}) },
    };

    if (this._openAkSk) {
      try {
        working = await this._signRequest(method, fullUrl, {
          ...working,
          data: body,
          // The params were folded into `fullUrl` above; sign the same set so the
          // canonical query cannot diverge from the wire query.
          params,
        });
      } catch (error) {
        return new RequestResult({
          success: false,
          statusCode: 0,
          error: `Unexpected error: ${error}`,
        });
      }
    }

    const timeoutMs = (working.timeout ?? this._config.timeout) * 1000;

    try {
      const response = await fetch(fullUrl, {
        method,
        headers: working.headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: this._dispatcherForRequest(),
      } as any);

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const text = await response.text();
      let data: any = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      let errorMsg: string | null = null;
      if (!response.ok) {
        const dict = _asDict(data);
        if (dict) {
          errorMsg =
            (dict['error'] as string) ||
            (dict['message'] as string) ||
            (dict['error_msg'] as string) ||
            text;
        } else {
          errorMsg = text || `HTTP ${response.status}`;
        }
      }

      return new RequestResult({
        success: response.ok,
        statusCode: response.status,
        data,
        error: errorMsg,
        headers,
      });
    } catch (error) {
      const name = (error as any)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        return new RequestResult({
          success: false,
          statusCode: 0,
          error: `Request timeout: ${error}`,
        });
      }
      if (error instanceof TypeError) {
        return new RequestResult({
          success: false,
          statusCode: 0,
          error: `Request error: ${error}`,
        });
      }
      return new RequestResult({
        success: false,
        statusCode: 0,
        error: `Unexpected error: ${error}`,
      });
    }
  }

  /** TLS dispatcher honouring `RequestConfig.verifySsl` for raw requests. */
  private _dispatcherForRequest(): any {
    const verifySsl = this._config.verifySsl;
    if (verifySsl === true) {
      return undefined;
    }
    if (!this._tlsDispatcher) {
      const connect: Record<string, any> = {};
      if (verifySsl === false) {
        connect.rejectUnauthorized = false;
      } else if (typeof verifySsl === 'string') {
        try {
          connect.ca = readFileSync(verifySsl);
        } catch (error) {
          log.warning(`Failed to read CA file '${verifySsl}': ${error}`);
        }
      }
      this._tlsDispatcher = new Agent({ connect });
    }
    return this._tlsDispatcher;
  }
}

/** A parsed JSON response, or an async stream of decoded SSE payloads. */
export type RuntimeResponse = Record<string, any> | AsyncGenerator<string>;

/**
 * Narrow a {@link RuntimeResponse} to its streaming form.
 *
 * Node.js equivalent of Python's `isinstance(result, Iterator)` check.
 */
export function isStreamingResponse(value: unknown): value is AsyncGenerator<string> {
  return (
    _present(value) &&
    typeof (value as any)[Symbol.asyncIterator] === 'function' &&
    typeof (value as any).next === 'function'
  );
}

/** Constructor options for {@link StreamDownloadResult}. */
export interface StreamDownloadResultInit {
  success: boolean;
  statusCode?: number;
  contentType?: string;
  error?: string | null;
  /** The streaming {@link RequestResult} backing the byte stream. */
  rawResponse?: RequestResult | null;
}

/** Streaming download result (Python `StreamDownloadResult` dataclass). */
export class StreamDownloadResult {
  success: boolean;
  statusCode: number;
  contentType: string;
  error: string | null;
  /** Underlying streaming response; cleared by {@link close}. */
  _rawResponse: RequestResult | null;

  constructor(init: StreamDownloadResultInit) {
    this.success = init.success;
    this.statusCode = init.statusCode ?? 0;
    this.contentType = init.contentType ?? '';
    this.error = init.error ?? null;
    this._rawResponse = init.rawResponse ?? null;
  }

  /** Iterate over the downloaded byte stream. */
  async *iterBytes(): AsyncGenerator<Uint8Array> {
    if (this._rawResponse === null) {
      throw new Error('No response available');
    }
    for await (const chunk of this._rawResponse.iterBytes()) {
      if (chunk && chunk.length > 0) {
        yield chunk;
      }
    }
  }

  /** Close the underlying response. */
  close(): void {
    if (this._rawResponse !== null) {
      this._rawResponse.close();
      this._rawResponse = null;
    }
  }

  /** Serialize to the wire (snake_case) representation. */
  toDict(): Record<string, any> {
    const result: Record<string, any> = { success: this.success };
    if (_present(this.statusCode)) result['status_code'] = this.statusCode;
    if (_present(this.contentType) && this.contentType !== '') {
      result['content_type'] = this.contentType;
    }
    if (_present(this.error)) result['error'] = this.error;
    return result;
  }

  /** Deserialize from the wire (snake_case) representation. */
  static fromDict(dict?: Record<string, any> | null): StreamDownloadResult {
    const model = new StreamDownloadResult({ success: false });
    if (dict) {
      if (dict['success'] !== undefined) model.success = dict['success'];
      if (dict['status_code'] !== undefined) model.statusCode = dict['status_code'];
      if (dict['content_type'] !== undefined) model.contentType = dict['content_type'];
      if (dict['error'] !== undefined) model.error = dict['error'];
    }
    return model;
  }
}

/** Options accepted by {@link RuntimeClient}'s constructor. */
export interface RuntimeClientOptions {
  /**
   * Override the control plane base URL. When omitted (or empty) the URL is
   * derived from the environment via `getControlPlaneEndpoint()`.
   */
  controlEndpoint?: string | null;
  /**
   * Override the data plane base URL. When omitted (or empty) the URL is
   * derived from the environment via `getRuntimeDataPlaneEndpoint()`.
   */
  dataEndpoint?: string | null;
  /** Bearer token for API authentication; can also be set later. */
  accessToken?: string | null;
  /** Default request timeout in seconds (default `30`). */
  timeout?: number;
  /**
   * SSL verification setting.
   * - `true`: verify certificates using the system CA bundle (default)
   * - `false`: skip verification (not recommended for production)
   * - `string`: path to a custom CA certificate file
   */
  verifySsl?: boolean | string;
  /** Signature mode for data plane requests. */
  signMode?: SignMode;
  /** Region ID for V11 signature mode. */
  regionId?: string;
}

/** Options for {@link RuntimeClient.createAgent}. */
export interface CreateAgentOptions {
  description?: string;
  artifactSourceConfig?: Record<string, any> | null;
  envVars?: Array<Record<string, any>> | null;
  identityConfig?: Record<string, any> | null;
  executionAgencyName?: string | null;
  networkConfig?: Record<string, any> | null;
  agentGatewayId?: string | null;
  invokeConfig?: Record<string, any> | null;
  observabilityConfig?: Record<string, any> | null;
  storageConfig?: Record<string, any> | null;
  tagsConfig?: Array<Record<string, any>> | null;
  /**
   * Runtime lifecycle configuration. May contain:
   * - `idle_session_timeout_sec`: int, 60-604800 seconds; unset uses 900.
   * - `max_alive_time_sec`: int, 60-604800 seconds; unset uses 86400.
   */
  lifecycleConfig?: Record<string, any> | null;
  /** Additional fields forwarded to the API (Python's `**extra`). */
  extra?: Record<string, any>;
}

/** Options for {@link RuntimeClient.updateAgent}. */
export interface UpdateAgentOptions {
  description?: string;
  artifactSourceConfig?: Record<string, any> | null;
  envVars?: Array<Record<string, any>> | null;
  executionAgencyName?: string | null;
  networkConfig?: Record<string, any> | null;
  agentGatewayId?: string | null;
  invokeConfig?: Record<string, any> | null;
  observabilityConfig?: Record<string, any> | null;
  storageConfig?: Record<string, any> | null;
  tagsConfig?: Array<Record<string, any>> | null;
  /** Runtime lifecycle configuration (see {@link CreateAgentOptions}). */
  lifecycleConfig?: Record<string, any> | null;
  /** Additional fields forwarded to the API (Python's `**extra`). */
  extra?: Record<string, any>;
}

/** Options for {@link RuntimeClient.createOrUpdateAgent}. */
export interface CreateOrUpdateAgentOptions extends UpdateAgentOptions {
  identityConfig?: Record<string, any> | null;
}

/** Options for {@link RuntimeClient.getAgents}. */
export interface GetAgentsOptions {
  /** Filter by agent name (fuzzy match). */
  agentName?: string;
  /** Pagination offset (default `1`). */
  offset?: number;
  /** Maximum number of results (default `10`). */
  limit?: number;
  /** Additional query parameters (Python's `**extra`). */
  extra?: Record<string, any>;
}

/** Options for {@link RuntimeClient.createAgentEndpoint}. */
export interface CreateAgentEndpointOptions {
  /** Endpoint type, default `"invocations"`. */
  endpointType?: string;
  config?: Record<string, any> | null;
  /** Additional fields forwarded to the API (Python's `**extra`). */
  extra?: Record<string, any>;
}

/** Options for {@link RuntimeClient.updateAgentEndpoint}. */
export interface UpdateAgentEndpointOptions {
  config?: Record<string, any> | null;
  /** Additional fields forwarded to the API (Python's `**extra`). */
  extra?: Record<string, any>;
}

/** Options for {@link RuntimeClient.invokeAgent}. */
export interface InvokeAgentOptions {
  /** Bearer token sent in the `Authorization` header. */
  bearerToken?: string | null;
  /** Endpoint name, sent as the `?endpoint=` query parameter. */
  endpoint?: string | null;
  /** Request timeout in seconds (default `900`). */
  timeout?: number;
  /** User ID for OAuth2 outbound credentials. */
  userId?: string | null;
  /** Additional path segment appended to `/invocations` (e.g. `"stream"`). */
  customPath?: string | null;
}

/** Options for {@link RuntimeClient.execCommand}. */
export interface ExecCommandOptions {
  /**
   * Use chunked streaming (`Command-Type: chunked`). The backend responds with
   * `application/x-ndjson` (one JSON object per line).
   */
  chunked?: boolean;
  bearerToken?: string | null;
  endpoint?: string | null;
  userId?: string | null;
  /** Command execution timeout in seconds (default `900`). */
  timeout?: number;
}

/** File specification accepted by {@link RuntimeClient.uploadFiles}. */
export interface UploadFileSpec {
  /** Local file path to upload. Python wire alias: `local_file`. */
  localFile?: string;
  /** In-memory payload (string is sent as UTF-8, bytes as-is). */
  content?: string | Uint8Array | null;
  /** Remote filename override. */
  filename?: string;
  /** Remote path override. */
  path?: string;
  /** Accepts the Python wire names (`local_file`, ...) as well. */
  [key: string]: any;
}

/** Options for {@link RuntimeClient.uploadFiles}. */
export interface UploadFilesOptions {
  /**
   * Remote directory path (must end with `/`). For a single file upload this is
   * the full remote file path unless the spec overrides it.
   */
  path?: string;
  fileUserId?: number | null;
  fileGroupId?: number | null;
  /** File mode in octal, e.g. `"0755"`. */
  fileMode?: string | null;
  bearerToken?: string | null;
  endpoint?: string | null;
  userId?: string | null;
  /** Request timeout in seconds (default `900`). */
  timeout?: number;
}

/** Options for {@link RuntimeClient.downloadFiles}. */
export interface DownloadFilesOptions {
  /** `false` downloads a single file, `true` downloads a directory as a tar. */
  recursive?: boolean;
  bearerToken?: string | null;
  endpoint?: string | null;
  userId?: string | null;
  /** Request timeout in seconds (default `900`). */
  timeout?: number;
}

/** Options for {@link RuntimeClient.stopSession}. */
export interface StopSessionOptions {
  bearerToken?: string | null;
  endpoint?: string | null;
  userId?: string | null;
  /** Request timeout in seconds (default `30`). */
  timeout?: number;
}

/** Options for {@link RuntimeClient.startSession}. */
export interface StartSessionOptions {
  bearerToken?: string | null;
  endpoint?: string | null;
  userId?: string | null;
  /** Request timeout in seconds (default `30`). */
  timeout?: number;
}

/** Options for {@link LocalRuntimeClient.invokeAgent}. */
export interface LocalInvokeAgentOptions {
  sessionId?: string | null;
  bearerToken?: string | null;
  endpoint?: string | null;
  /** Request timeout in seconds; defaults to the client timeout. */
  timeout?: number | null;
  userId?: string | null;
  /** Additional path segment appended to `/invocations` (e.g. `"stream"`). */
  customPath?: string | null;
}

/** Options for {@link LocalRuntimeClient.pingAgent}. */
export interface LocalPingAgentOptions {
  bearerToken?: string | null;
  endpoint?: string | null;
  sessionId?: string | null;
  /** Request timeout in seconds (default `30`). */
  timeout?: number | null;
  userId?: string | null;
}

/** Read a camelCase spec field, falling back to its Python wire name. */
function _specValue(spec: UploadFileSpec, camelCase: string, snakeCase: string): any {
  const value = spec[camelCase];
  return value !== undefined ? value : spec[snakeCase];
}

/**
 * Client for the AgentArts runtime service.
 *
 * Provides typed methods for every control-plane and data-plane API exposed by
 * the AgentArts platform. Separate HTTP clients are used for the control and
 * data planes so that both can be configured (and authenticated) independently.
 */
export class RuntimeClient {
  /** Control plane base URL. */
  readonly _controlBase: string;
  /** Data plane base URL. */
  readonly _dataBase: string;
  /** Default request timeout in seconds. */
  readonly _timeout: number;
  /** SSL verification setting. */
  readonly _verifySsl: boolean | string;
  /** Current bearer token, if any. */
  _accessToken: string | null;
  /** Signature mode for data plane requests. */
  readonly _signMode: SignMode;
  /** Region ID used by the V11 signer. */
  readonly _regionId: string;

  private readonly _controlClient: RuntimeHTTPClient;
  private readonly _dataClient: RuntimeHTTPClient;

  /**
   * @param options Client options; omitted endpoints are derived from the
   *   environment (`AGENTARTS_CONTROL_ENDPOINT`, `AGENTARTS_RUNTIME_DATA_ENDPOINT`
   *   or the region defaults).
   */
  constructor(options: RuntimeClientOptions = {}) {
    this._controlBase = options.controlEndpoint || getControlPlaneEndpoint();
    this._dataBase = options.dataEndpoint || getRuntimeDataPlaneEndpoint();
    this._timeout = options.timeout ?? 30.0;
    this._verifySsl = options.verifySsl ?? true;
    this._accessToken = options.accessToken ?? null;
    this._signMode = options.signMode ?? SignMode.SDK_HMAC_SHA256;
    this._regionId = options.regionId ?? '';

    this._controlClient = new RuntimeHTTPClient(
      new RequestConfig({
        baseUrl: this._controlBase,
        timeout: this._timeout,
        verifySsl: this._verifySsl,
      }),
      true,
    );

    this._dataClient = new RuntimeHTTPClient(
      new RequestConfig({
        baseUrl: this._dataBase,
        timeout: this._timeout,
        verifySsl: this._verifySsl,
      }),
      this._signMode === SignMode.V11_HMAC_SHA256,
      this._signMode,
      this._regionId,
    );

    if (this._accessToken) {
      this.setAuthToken(this._accessToken);
    }
  }

  /** Set the Bearer token for authentication. */
  setAuthToken(token: string): void {
    this._accessToken = token;
    this._dataClient.setAuthToken(token);
  }

  /** Send a request to the control plane. */
  async _control(method: string, path: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._controlClient.send(method, path, options);
  }

  /** Send a request to the data plane. */
  async _data(method: string, path: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._dataClient.send(method, path, options);
  }

  /**
   * Send a request with a raw binary body to the data plane.
   *
   * Node.js-only helper: `BaseHTTPClient` cannot carry binary bodies through its
   * object-body serialization, so uploads use the raw path.
   */
  async _dataBinary(
    method: string,
    path: string,
    body: Uint8Array,
    options: RequestOptions = {},
  ): Promise<RequestResult> {
    return this._dataClient.sendBinary(method, path, body, options);
  }

  /** Raise on an unsuccessful response and return the parsed data. */
  static _check(result: RequestResult, operation: string): Record<string, any> {
    if (!result.success) {
      log.error(
        `${operation} failed: status=${result.statusCode}, data=${_formatValue(result.data)}, error=${result.error}`,
      );
      throw new Error(`${operation} failed (HTTP ${result.statusCode}): ${result.error}`);
    }
    return _asDict(result.data) ?? {};
  }

  /** Check whether the response Content-Type is `text/event-stream`. */
  static _isStreamResponse(result: RequestResult): boolean {
    return _headerValue(result.headers, 'Content-Type').includes('text/event-stream');
  }

  /**
   * Dispatch a response based on its streaming state.
   *
   * When `result.streaming` is `true` the Content-Type header is inspected:
   *
   * - `text/event-stream` → returns an async generator that yields one decoded
   *   SSE event payload per iteration.
   * - Other content types → the body is fully consumed, the response is closed,
   *   and a parsed JSON object is returned.
   *
   * For non-streaming results the existing `result.data` is returned directly
   * (parsed as JSON when it is a string).
   */
  async _dispatchResponse(result: RequestResult, operation: string): Promise<RuntimeResponse> {
    if (!result.success) {
      log.error(
        `${operation} failed: status=${result.statusCode}, data=${_formatValue(result.data)} error=${result.error}`,
      );
      throw new Error(`${operation} failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    if (result.streaming) {
      if (RuntimeClient._isStreamResponse(result)) {
        return RuntimeClient._parseSseStream(result.iterLines());
      }

      const chunks: Uint8Array[] = [];
      for await (const chunk of result.iterBytes()) {
        chunks.push(chunk);
      }
      result.close();
      const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      try {
        return JSON.parse(body.toString('utf8'));
      } catch {
        return { raw: body.toString('utf8') };
      }
    }

    const data = result.data;
    const dict = _asDict(data);
    if (dict) {
      return dict;
    }
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return { raw: data };
      }
    }
    return { data };
  }

  /**
   * Parse decoded text lines into SSE event payloads.
   *
   * Each yielded value is the content of a single `data:` line (without the
   * `data: ` prefix). The underlying streaming response is closed automatically
   * once the iterator is exhausted (handled by `RequestResult.iterLines()`).
   */
  static async *_parseSseStream(lineIterator: AsyncIterable<string>): AsyncGenerator<string> {
    let buffer = '';
    for await (const line of lineIterator) {
      if (line === '') {
        if (buffer) {
          for (const eventLine of buffer.split(/\r\n|\r|\n/)) {
            if (eventLine.startsWith('data: ')) {
              const payload = eventLine.slice(6);
              if (payload.trim() === '[DONE]') {
                return;
              }
              yield payload;
            }
          }
          buffer = '';
        }
      } else {
        buffer = buffer ? `${buffer}\n${line}` : line;
      }
    }
  }

  /**
   * Create a new agent.
   *
   * @param name Agent name (unique within the workspace).
   * @param options Description, artifact source, environment variables and the
   *   other optional creation fields.
   * @returns The created agent object from the API.
   */
  async createAgent(name: string, options: CreateAgentOptions = {}): Promise<Record<string, any>> {
    const payload: Record<string, any> = { name };
    for (const [key, value] of Object.entries(options.extra ?? {})) {
      if (_present(value)) {
        payload[key] = value;
      }
    }
    const description = options.description ?? '';
    if (description) {
      payload['description'] = description;
    }
    if (_present(options.artifactSourceConfig)) {
      payload['artifact_source'] = options.artifactSourceConfig;
    }
    if (_present(options.envVars)) {
      payload['environment_variables'] = options.envVars;
    }
    if (_present(options.identityConfig)) {
      payload['identity_configuration'] = options.identityConfig;
    }
    if (_present(options.executionAgencyName)) {
      payload['execution_agency_name'] = options.executionAgencyName;
    }
    if (_present(options.networkConfig)) {
      payload['network_config'] = options.networkConfig;
    }
    if (_present(options.agentGatewayId)) {
      payload['agent_gateway_id'] = options.agentGatewayId;
    }
    if (_present(options.invokeConfig)) {
      payload['invoke_config'] = options.invokeConfig;
    }
    if (_present(options.observabilityConfig)) {
      payload['observability'] = options.observabilityConfig;
    }
    if (_present(options.storageConfig)) {
      payload['storage_config'] = options.storageConfig;
    }
    if (_present(options.lifecycleConfig)) {
      payload['lifecycle_config'] = options.lifecycleConfig;
    }
    if (_present(options.tagsConfig)) {
      payload['tags'] = options.tagsConfig;
    }

    const result = await this._control('POST', '/v1/core/runtimes', { json: payload });
    return RuntimeClient._check(result, 'create_agent');
  }

  /**
   * Update an existing agent.
   *
   * @param agentId The unique agent identifier.
   * @param options New values; the description is always sent (Python default
   *   `""`), the other fields are only sent when provided.
   * @returns The updated agent object.
   */
  async updateAgent(agentId: string, options: UpdateAgentOptions = {}): Promise<Record<string, any>> {
    const payload: Record<string, any> = {};
    for (const [key, value] of Object.entries(options.extra ?? {})) {
      if (_present(value)) {
        payload[key] = value;
      }
    }
    payload['description'] = options.description ?? '';
    if (_present(options.artifactSourceConfig)) {
      payload['artifact_source'] = options.artifactSourceConfig;
    }
    if (_present(options.envVars)) {
      payload['environment_variables'] = options.envVars;
    }
    if (_present(options.executionAgencyName)) {
      payload['execution_agency_name'] = options.executionAgencyName;
    }
    if (_present(options.networkConfig)) {
      payload['network_config'] = options.networkConfig;
    }
    if (_present(options.agentGatewayId)) {
      payload['agent_gateway_id'] = options.agentGatewayId;
    }
    if (_present(options.invokeConfig)) {
      payload['invoke_config'] = options.invokeConfig;
    }
    if (_present(options.observabilityConfig)) {
      payload['observability'] = options.observabilityConfig;
    }
    if (_present(options.storageConfig)) {
      payload['storage_config'] = options.storageConfig;
    }
    if (_present(options.lifecycleConfig)) {
      payload['lifecycle_config'] = options.lifecycleConfig;
    }
    if (_present(options.tagsConfig)) {
      payload['tags'] = options.tagsConfig;
    }

    const result = await this._control('PUT', `/v1/core/runtimes/${agentId}`, { json: payload });
    return RuntimeClient._check(result, 'update_agent');
  }

  /**
   * Create or update an agent (upsert semantics).
   *
   * Queries the agent by `agentName` first. If an agent with that name already
   * exists it is updated via `PUT`; otherwise a new agent is created via `POST`.
   *
   * @param agentName Agent name (used as the lookup key).
   * @param options Creation/update fields.
   * @returns The agent object from the API.
   */
  async createOrUpdateAgent(
    agentName: string,
    options: CreateOrUpdateAgentOptions = {},
  ): Promise<Record<string, any>> {
    const existing = await this.findAgentByName(agentName);
    const description = options.description ?? '';

    if (existing) {
      const agentId = existing['id'];
      log.info(`Agent '${agentName}' found (ID: ${_formatValue(agentId)}), updating`);
      return this.updateAgent(agentId, {
        description,
        artifactSourceConfig: options.artifactSourceConfig,
        envVars: options.envVars,
        executionAgencyName: options.executionAgencyName,
        networkConfig: options.networkConfig,
        agentGatewayId: options.agentGatewayId,
        invokeConfig: options.invokeConfig,
        observabilityConfig: options.observabilityConfig,
        storageConfig: options.storageConfig,
        lifecycleConfig: options.lifecycleConfig,
        tagsConfig: options.tagsConfig,
        extra: options.extra,
      });
    }

    log.debug(`Agent '${agentName}' not found, creating`);
    return this.createAgent(agentName, {
      description,
      artifactSourceConfig: options.artifactSourceConfig,
      envVars: options.envVars,
      identityConfig: options.identityConfig,
      executionAgencyName: options.executionAgencyName,
      networkConfig: options.networkConfig,
      agentGatewayId: options.agentGatewayId,
      invokeConfig: options.invokeConfig,
      observabilityConfig: options.observabilityConfig,
      storageConfig: options.storageConfig,
      lifecycleConfig: options.lifecycleConfig,
      tagsConfig: options.tagsConfig,
      extra: options.extra,
    });
  }

  /**
   * List agents.
   *
   * @param options Name filter, pagination and additional query parameters.
   * @returns A list of agent objects.
   */
  async getAgents(options: GetAgentsOptions = {}): Promise<Array<Record<string, any>>> {
    const params: Record<string, any> = {
      offset: options.offset ?? 1,
      limit: options.limit ?? 10,
      ...(options.extra ?? {}),
    };
    const agentName = options.agentName ?? '';
    if (agentName) {
      params['agent_name'] = agentName;
    }

    const result = await this._control('GET', '/v1/core/runtimes', { params });
    const data = RuntimeClient._check(result, 'get_agents');
    if (Array.isArray(data)) {
      return data;
    }
    const items = data['items'] ?? data['agents'] ?? [];
    return Array.isArray(items) ? items : [];
  }

  /**
   * Find an agent by its name.
   *
   * @param agentName Agent name to search for.
   * @returns The matching agent object, or `null` when no agent matches.
   */
  async findAgentByName(agentName: string): Promise<Record<string, any> | null> {
    const params: Record<string, any> = { name: agentName, match_type: 'EXACT' };

    const result = await this._control('GET', '/v1/core/runtimes', { params });
    const responseData = RuntimeClient._check(result, 'find_agent_by_name');

    let agents: any[] = [];
    if (Array.isArray(responseData)) {
      agents = responseData;
    } else {
      agents = responseData['items'] ?? [];
    }

    for (const agent of agents) {
      if (_asDict(agent) && agent['name'] === agentName) {
        return agent as Record<string, any>;
      }
    }
    return null;
  }

  /**
   * Find an agent by its unique identifier.
   *
   * @param agentId The agent ID.
   * @returns The agent object.
   */
  async findAgentById(agentId: string): Promise<Record<string, any> | null> {
    const result = await this._control('GET', `/v1/core/runtimes/${agentId}`);
    return RuntimeClient._check(result, 'find_agent_by_id');
  }

  /**
   * Delete an agent by its name.
   *
   * @param agentName Agent name to delete.
   * @returns `true` when the agent was deleted, `false` when it was not found.
   */
  async deleteAgentByName(agentName: string): Promise<boolean> {
    const existing = await this.findAgentByName(agentName);
    const agentId = existing ? existing['id'] : undefined;
    if (!agentId) {
      log.warning(`Agent '${agentName}' not found, nothing to delete`);
      return false;
    }

    const result = await this._control('DELETE', `/v1/core/runtimes/${agentId}`);
    RuntimeClient._check(result, 'delete_agent_by_name');
    return true;
  }

  /**
   * Create an endpoint for an agent.
   *
   * @param agentId The agent to attach the endpoint to.
   * @param endpointName Endpoint name.
   * @param options Endpoint type (`"invocations"` by default) and config.
   * @returns The created endpoint object.
   */
  async createAgentEndpoint(
    agentId: string,
    endpointName: string,
    options: CreateAgentEndpointOptions = {},
  ): Promise<Record<string, any>> {
    const payload: Record<string, any> = {
      agent_id: agentId,
      endpoint_name: endpointName,
      endpoint_type: options.endpointType ?? 'invocations',
      ...(options.extra ?? {}),
    };
    if (_present(options.config)) {
      payload['config'] = options.config;
    }

    const result = await this._control('POST', `/v1/core/runtimes/${agentId}/endpoints`, {
      json: payload,
    });
    return RuntimeClient._check(result, 'create_agent_endpoint');
  }

  /**
   * Update an existing agent endpoint.
   *
   * @param agentId The agent the endpoint belongs to.
   * @param endpointName Name of the endpoint to update.
   * @param options New endpoint configuration.
   * @returns The updated endpoint object.
   */
  async updateAgentEndpoint(
    agentId: string,
    endpointName: string,
    options: UpdateAgentEndpointOptions = {},
  ): Promise<Record<string, any>> {
    const payload: Record<string, any> = {
      endpoint_name: endpointName,
      ...(options.extra ?? {}),
    };
    if (_present(options.config)) {
      payload['config'] = options.config;
    }

    const result = await this._control(
      'PUT',
      `/v1/core/runtimes/${agentId}/endpoints/${endpointName}`,
      { json: payload },
    );
    return RuntimeClient._check(result, 'update_agent_endpoint');
  }

  /**
   * Delete an agent endpoint.
   *
   * @param agentId The agent the endpoint belongs to.
   * @param endpointName Name of the endpoint to delete.
   * @returns The deletion response.
   */
  async deleteAgentEndpoint(agentId: string, endpointName: string): Promise<Record<string, any>> {
    const result = await this._control(
      'DELETE',
      `/v1/core/runtimes/${agentId}/endpoints/${endpointName}`,
    );
    return RuntimeClient._check(result, 'delete_agent_endpoint');
  }

  /**
   * Find an agent endpoint by name.
   *
   * @param agentId The agent the endpoint belongs to.
   * @param endpointName Name of the endpoint.
   * @returns The endpoint object.
   */
  async findAgentEndpoint(agentId: string, endpointName: string): Promise<Record<string, any>> {
    const result = await this._control(
      'GET',
      `/v1/core/runtimes/${agentId}/endpoints/${endpointName}`,
    );
    return RuntimeClient._check(result, 'find_agent_endpoint');
  }

  /**
   * Invoke an agent on the data plane.
   *
   * When the server responds with `Content-Type: text/event-stream`, the result
   * is an `AsyncGenerator<string>` yielding one decoded SSE event payload per
   * iteration (use {@link isStreamingResponse} to narrow the union). Otherwise a
   * parsed JSON object is returned.
   *
   * @param agentName The agent to invoke.
   * @param sessionId Session identifier for stateful agents, sent as the
   *   `SESSION_HEADER` header.
   * @param payload Input data for the agent (JSON string).
   * @param options Bearer token, endpoint, timeout, user ID and custom path.
   */
  async invokeAgent(
    agentName: string,
    sessionId: string,
    payload: string,
    options: InvokeAgentOptions = {},
  ): Promise<RuntimeResponse> {
    let path = `/runtimes/${agentName}/invocations`;
    if (options.customPath) {
      path = `${path}/${options.customPath}`;
    }
    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const headers: Record<string, string> = {
      [SESSION_HEADER]: sessionId,
      'Content-Type': 'application/json',
    };
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const result = await this._data('POST', path, {
      data: payload,
      params: Object.keys(params).length > 0 ? params : undefined,
      headers,
      timeout: options.timeout ?? 900,
    });

    return this._dispatchResponse(result, 'invoke_agent');
  }

  /**
   * Execute a command in the runtime, with optional streaming response.
   *
   * @param agentName The agent name.
   * @param sessionId Session identifier.
   * @param command Command array to execute (e.g. `["ls", "-la"]`).
   * @param options `chunked` selects ndjson streaming, `timeout` (seconds) is
   *   sent in the request body while the HTTP timeout is `timeout + 60`.
   * @returns An object for normal mode, an async generator of ndjson lines for
   *   chunked mode.
   */
  async execCommand(
    agentName: string,
    sessionId: string,
    command: string[],
    options: ExecCommandOptions = {},
  ): Promise<RuntimeResponse> {
    const path = `/runtimes/${agentName}/commands`;
    const headers: Record<string, string> = {
      [SESSION_HEADER]: sessionId,
      'Content-Type': 'application/json',
    };
    if (options.chunked) {
      headers['Command-Type'] = 'chunked';
    }
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const timeout = options.timeout ?? 900;
    const result = await this._data('POST', path, {
      json: { command, timeout },
      params: Object.keys(params).length > 0 ? params : undefined,
      headers,
      timeout: timeout + 60,
    });

    if (!result.success) {
      log.error(`exec_command failed: status=${result.statusCode}, error=${result.error}`);
      throw new Error(`exec_command failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    if (options.chunked) {
      const contentType = _headerValue(result.headers, 'Content-Type');
      if (contentType.includes('application/x-ndjson') || result.streaming) {
        return this._parseNdjsonStream(result);
      }
    }

    return _asDict(result.data) ?? { result: result.data };
  }

  /** Parse an ndjson streaming response (each line is a JSON object). */
  async *_parseNdjsonStream(result: RequestResult): AsyncGenerator<string> {
    try {
      for await (const line of result.iterLines()) {
        if (line) {
          yield line;
        }
      }
    } finally {
      result.close();
    }
  }

  /**
   * Upload files to the runtime.
   *
   * Automatically selects the upload mode:
   * - single file: `application/octet-stream` (or `application/x-tar` when the
   *   payload is detected as a tar archive)
   * - multiple files: `multipart/form-data`
   *
   * @param agentName The agent name.
   * @param sessionId Session identifier.
   * @param files File specs, each with `localFile` or `content`.
   * @param options Remote path, ownership/mode metadata, auth and timeout.
   * @returns The upload result.
   */
  async uploadFiles(
    agentName: string,
    sessionId: string,
    files: UploadFileSpec[],
    options: UploadFilesOptions = {},
  ): Promise<Record<string, any>> {
    const path = options.path ?? '/tmp/';

    if (!files || files.length === 0) {
      throw new Error('Files list cannot be empty');
    }

    for (let index = 0; index < files.length; index += 1) {
      const fileSpec = files[index];
      const localFile = _specValue(fileSpec, 'localFile', 'local_file');
      if (localFile && existsSync(localFile)) {
        const fileSize = statSync(localFile).size;
        if (fileSize > _MAX_FILE_SIZE) {
          throw new Error(
            `File too large: ${localFile} (${(fileSize / 1024 / 1024).toFixed(1)}MB, max 100MB)`,
          );
        }
      }
      const content = fileSpec['content'];
      if (_present(content)) {
        const contentSize =
          typeof content === 'string' || content instanceof Uint8Array ? content.length : 0;
        if (contentSize > _MAX_FILE_SIZE) {
          throw new Error(
            `Content too large for file ${index} (${(contentSize / 1024 / 1024).toFixed(1)}MB, max 100MB)`,
          );
        }
      }
    }

    const timeout = options.timeout ?? 900;
    let result: RequestResult;

    if (files.length === 1) {
      const file = files[0];
      const localFile = _specValue(file, 'localFile', 'local_file') as string | undefined;
      let content: any = null;
      if (!localFile) {
        content = file['content'];
        if (!_present(content)) {
          throw new Error('File local_file or content is required');
        }
      }

      const filename = localFile
        ? basename(localFile)
        : ((file['filename'] as string | undefined) ?? 'file_0');
      const isTar = isTarPayload(
        localFile ?? null,
        content,
        (file['filename'] as string | undefined) ?? null,
      );

      // The x-tar backend extracts the archive into `path`, which must be a
      // directory ending with '/'. Do NOT append the filename: entry names live
      // inside the tar, and a file path like /tmp/x.tar is rejected with
      // "path must be a directory ending with '/'". octet-stream instead wants
      // the full file path.
      let remotePath: string;
      const specPath = file['path'] as string | undefined;
      if (isTar) {
        remotePath = specPath || path;
        if (!remotePath.endsWith('/')) {
          remotePath += '/';
        }
      } else {
        remotePath = specPath || `${path}${filename}`;
      }

      const apiEndpoint = `/runtimes/${agentName}/upload-files`;
      const headers: Record<string, string> = {
        [SESSION_HEADER]: sessionId,
        'Content-Type': isTar ? 'application/x-tar' : 'application/octet-stream',
      };
      if (options.bearerToken) {
        headers['Authorization'] = `Bearer ${options.bearerToken}`;
      }
      if (options.userId) {
        headers[USER_ID_HEADER] = options.userId;
      }

      const params: Record<string, any> = { path: remotePath };
      if (_present(options.fileUserId)) {
        params['user_id'] = options.fileUserId;
      }
      if (_present(options.fileGroupId)) {
        params['group_id'] = options.fileGroupId;
      }
      if (_present(options.fileMode)) {
        params['file_mode'] = options.fileMode;
      }
      if (options.endpoint) {
        params['endpoint'] = options.endpoint;
      }

      if (localFile) {
        result = await this._dataBinary('POST', apiEndpoint, readFileSync(localFile), {
          headers,
          params,
          timeout,
        });
      } else if (typeof content === 'string') {
        result = await this._data('POST', apiEndpoint, { data: content, headers, params, timeout });
      } else {
        result = await this._dataBinary('POST', apiEndpoint, Buffer.from(content), {
          headers,
          params,
          timeout,
        });
      }
    } else {
      const apiEndpoint = `/runtimes/${agentName}/upload-files`;
      const headers: Record<string, string> = { [SESSION_HEADER]: sessionId };
      if (options.bearerToken) {
        headers['Authorization'] = `Bearer ${options.bearerToken}`;
      }
      if (options.userId) {
        headers[USER_ID_HEADER] = options.userId;
      }

      const params: Record<string, any> = { path };
      if (_present(options.fileUserId)) {
        params['user_id'] = options.fileUserId;
      }
      if (_present(options.fileGroupId)) {
        params['group_id'] = options.fileGroupId;
      }
      if (_present(options.fileMode)) {
        params['file_mode'] = options.fileMode;
      }
      if (options.endpoint) {
        params['endpoint'] = options.endpoint;
      }

      const multipartFiles: File[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const fileSpec = files[index];
        const localFile = _specValue(fileSpec, 'localFile', 'local_file') as string | undefined;
        if (localFile) {
          const filename = localFile.includes('\\')
            ? localFile.split('\\').pop()!
            : localFile.split('/').pop()!;
          multipartFiles.push(
            new File([readFileSync(localFile)], filename, {
              type: uploadContentType(localFile, null, filename),
            }),
          );
        } else {
          const content = fileSpec['content'];
          const filename =
            (fileSpec['filename'] as string | undefined) ?? `file_${index}`;
          if (content instanceof Uint8Array) {
            multipartFiles.push(
              new File([content], filename, {
                type: uploadContentType(null, content, filename),
              }),
            );
          } else {
            multipartFiles.push(
              new File([Buffer.from(String(content ?? ''), 'utf8')], filename, {
                type: 'text/plain',
              }),
            );
          }
        }
      }

      result = await this._data('POST', apiEndpoint, {
        files: { file: multipartFiles },
        headers,
        params,
        timeout,
      });
    }

    if (!result.success) {
      log.error(`upload_files failed: status=${result.statusCode}, error=${result.error}`);
      throw new Error(`upload_files failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    return _asDict(result.data) ?? { status: 'uploaded', files: files.length };
  }

  /**
   * Download a file or directory from the runtime with a streaming response.
   *
   * @param agentName The agent name.
   * @param sessionId Session identifier.
   * @param path Remote file/directory path.
   * @param options `recursive` downloads a directory as a tar archive.
   * @returns A {@link StreamDownloadResult}; use `iterBytes()` to consume it.
   */
  async downloadFiles(
    agentName: string,
    sessionId: string,
    path: string,
    options: DownloadFilesOptions = {},
  ): Promise<StreamDownloadResult> {
    const apiEndpoint = `/runtimes/${agentName}/download-files`;
    const headers: Record<string, string> = { [SESSION_HEADER]: sessionId };
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const params: Record<string, any> = {
      path,
      recursive: String(options.recursive ?? false).toLowerCase(),
    };
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const result = await this._requestStream('GET', apiEndpoint, true, {
      headers,
      params,
      timeout: options.timeout ?? 900,
    });

    if (result instanceof StreamDownloadResult) {
      return result;
    }

    return new StreamDownloadResult({
      success: result.success,
      statusCode: result.statusCode,
      contentType: _headerValue(result.headers, 'Content-Type'),
      error: result.error,
    });
  }

  /**
   * Execute an HTTP request with streaming response handling.
   *
   * @param method HTTP method.
   * @param url Relative URL path.
   * @param acceptStream Whether to return a {@link StreamDownloadResult} for
   *   `application/octet-stream` / `application/x-tar` responses.
   * @param options Additional request options.
   */
  async _requestStream(
    method: string,
    url: string,
    acceptStream = false,
    options: RequestOptions = {},
  ): Promise<RequestResult | StreamDownloadResult> {
    // AK/SK signing happens inside the shared request pipeline (V11 for IAM
    // agents), so streamed downloads are signed exactly like `_data` requests.
    const result = await this._dataClient.send(method, url, { ...options, stream: true });

    if (!result.streaming) {
      return result;
    }

    const contentType = _headerValue(result.headers, 'Content-Type');
    const isStream = _STREAM_RESPONSE_TYPES.some((streamType) => contentType.includes(streamType));

    if (acceptStream && isStream && result.success) {
      return new StreamDownloadResult({
        success: true,
        statusCode: result.statusCode,
        contentType,
        rawResponse: result,
      });
    }

    if (isStream) {
      return result;
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of result.iterBytes()) {
      chunks.push(chunk);
    }
    result.close();

    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    let errorMsg: string | null = null;
    if (!result.success) {
      const dict = _asDict(data);
      if (dict) {
        errorMsg =
          (dict['error'] as string) ||
          (dict['message'] as string) ||
          (dict['error_msg'] as string) ||
          text;
      } else {
        errorMsg = text || `HTTP ${result.statusCode}`;
      }
    }

    return new RequestResult({
      success: result.success,
      statusCode: result.statusCode,
      data,
      error: errorMsg,
      headers: result.headers,
    });
  }

  /**
   * Stop a runtime session.
   *
   * @param agentName The agent name.
   * @param sessionId Session identifier.
   * @param options Auth, endpoint and timeout.
   * @returns The stop result.
   */
  async stopSession(
    agentName: string,
    sessionId: string,
    options: StopSessionOptions = {},
  ): Promise<Record<string, any>> {
    const path = `/runtimes/${agentName}/sessions-stop`;
    const headers: Record<string, string> = { [SESSION_HEADER]: sessionId };
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const result = await this._data('POST', path, {
      headers,
      params: Object.keys(params).length > 0 ? params : undefined,
      timeout: options.timeout ?? 30,
    });

    if (!result.success) {
      log.error(`stop_session failed: status=${result.statusCode}, error=${result.error}`);
      throw new Error(`stop_session failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    return _asDict(result.data) ?? { status: 'stopped' };
  }

  /**
   * Start a runtime session.
   *
   * @param agentName The agent name.
   * @param options Auth, endpoint and timeout.
   * @returns The start result, containing the session ID.
   */
  async startSession(agentName: string, options: StartSessionOptions = {}): Promise<Record<string, any>> {
    const path = `/runtimes/${agentName}/sessions-start`;
    const headers: Record<string, string> = {};
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const result = await this._data('POST', path, {
      headers,
      params: Object.keys(params).length > 0 ? params : undefined,
      timeout: options.timeout ?? 30,
    });

    if (!result.success) {
      log.error(`start_session failed: status=${result.statusCode}, error=${result.error}`);
      throw new Error(`start_session failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    return _asDict(result.data) ?? {};
  }
}

/**
 * Client for invoking a local Docker container runtime.
 *
 * Provides methods to invoke and health-check agents running in local Docker
 * containers.
 */
export class LocalRuntimeClient extends BaseHTTPClient {
  private readonly _port: number;
  private readonly _host: string;
  private readonly _baseUrl: string;

  /**
   * @param port Local port where the agent is running (default `8080`).
   * @param host Host address (default `"localhost"`).
   * @param timeout Default request timeout in seconds (default `300`).
   */
  constructor(port = 8080, host = 'localhost', timeout = 300.0) {
    super(new RequestConfig({ baseUrl: `http://${host}:${port}`, timeout }));
    this._port = port;
    this._host = host;
    this._baseUrl = `http://${host}:${port}`;
  }

  /**
   * Invoke a local agent.
   *
   * @param payload Input data for the agent (JSON string).
   * @param options Session ID, bearer token, endpoint, timeout, user ID and
   *   custom path.
   * @returns A parsed JSON object, or an async generator of SSE payloads for
   *   `text/event-stream` responses.
   */
  async invokeAgent(
    payload: string,
    options: LocalInvokeAgentOptions = {},
  ): Promise<RuntimeResponse> {
    let path = '/invocations';
    if (options.customPath) {
      path = `${path}/${options.customPath}`;
    }
    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (options.sessionId) {
      headers[SESSION_HEADER] = options.sessionId;
    }
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    // Python uses `timeout or self._config.timeout`, so falsy values fall back.
    const requestTimeout = options.timeout || this._config.timeout;

    const result = await this._request('POST', appendQueryParams(path, params), {
      data: payload,
      headers,
      timeout: requestTimeout,
    });

    if (!result.success) {
      if (result.statusCode === 0) {
        throw new Error(
          `Cannot connect to local endpoint at ${this._baseUrl}. ` +
            `Make sure the Docker container is running on port ${this._port}.`,
        );
      }
      throw new Error(`invoke_agent failed (HTTP ${result.statusCode}): ${result.error}`);
    }

    if (result.streaming) {
      if (RuntimeClient._isStreamResponse(result)) {
        return RuntimeClient._parseSseStream(result.iterLines());
      }
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.iterBytes()) {
        chunks.push(chunk);
      }
      result.close();
      const body = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      try {
        return JSON.parse(body.toString('utf8'));
      } catch {
        return { raw: body.toString('utf8') };
      }
    }

    const data = result.data;
    const dict = _asDict(data);
    if (dict) {
      return dict;
    }
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return { raw: data };
      }
    }
    return { data };
  }

  /**
   * Health-check a local agent.
   *
   * @param options Bearer token, endpoint, session ID, timeout and user ID.
   * @returns An object with a `status` field indicating the health status.
   */
  async pingAgent(options: LocalPingAgentOptions = {}): Promise<Record<string, any>> {
    const path = '/ping';

    const headers: Record<string, string> = {};
    if (options.bearerToken) {
      headers['Authorization'] = `Bearer ${options.bearerToken}`;
    }
    if (options.sessionId) {
      headers[SESSION_HEADER] = options.sessionId;
    }
    if (options.userId) {
      headers[USER_ID_HEADER] = options.userId;
    }

    const params: Record<string, any> = {};
    if (options.endpoint) {
      params['endpoint'] = options.endpoint;
    }

    // Python uses `timeout or 30`, so falsy values fall back.
    const requestTimeout = options.timeout || 30;

    const result = await this._request('GET', appendQueryParams(path, params), {
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      timeout: requestTimeout,
    });

    if (!result.success) {
      if (result.statusCode === 0) {
        throw new Error(
          `Cannot connect to local endpoint at ${this._baseUrl}. ` +
            `Make sure the Docker container is running on port ${this._port}.`,
        );
      }
      return {
        status: 'Unhealthy',
        status_code: result.statusCode,
        error: result.error,
      };
    }

    const data = result.data;
    const dict = _asDict(data);
    if (dict) {
      return { status: dict['status'] ?? 'Healthy', details: dict };
    }
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return { status: parsed['status'] ?? 'Healthy', details: parsed };
      } catch {
        return { status: 'Healthy', raw: data };
      }
    }
    return { status: 'Healthy', data };
  }
}

/**
 * HTTP client service for Huawei Memory API interactions.
 *
 * Mirrors `agentarts/sdk/service/memory_service.py`: authentication strategies
 * (data plane API Key / control plane AK-SK signing) plus the
 * `MemoryHttpService` used by the memory sub-clients.
 *
 * Requests are issued with the global `fetch` API (see PORTING.md §8) and error
 * semantics match the Python implementation:
 *
 * - network failures -> `MemoryAPIException(0, 'NETWORK_ERROR')`
 * - non-2xx responses -> `MemoryAPIException(statusCode, error_code, error_msg)`
 * - 2xx with an invalid JSON body -> `MemoryAPIException(statusCode, 'PARSE_ERROR')`
 */

import { readFileSync } from 'node:fs';

import { Agent } from 'undici';
import type { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';

import { getLogger } from '../utils/logging.js';
import { getMemoryEndpoint, getRegion } from '../utils/constant.js';
import { appendQueryParams, normalizeQueryParams } from '../utils/query.js';
import { SDKSigner } from '../utils/signer.js';
import { buildUserAgent } from '../utils/user-agent.js';
import { createCredential } from '../utils/metadata.js';
import { MemoryAPIException } from './http-client.js';

const logger = getLogger('sdk.service.memory_service');

/** Environment variable holding the data plane API Key. */
export const ENV_HUAWEICLOUD_SDK_MEMORY_API_KEY = 'HUAWEICLOUD_SDK_MEMORY_API_KEY';

/**
 * Create an undici dispatcher honoring the `verifySsl` setting.
 *
 * Returns `undefined` when the default (verifying) dispatcher should be used.
 */
export function createHttpDispatcher(verifySsl: boolean | string): any | undefined {
  if (verifySsl === true) {
    return undefined;
  }
  const connect: Record<string, any> = {};
  if (verifySsl === false) {
    connect.rejectUnauthorized = false;
  } else if (typeof verifySsl === 'string') {
    try {
      connect.ca = readFileSync(verifySsl);
    } catch (error) {
      logger.warning(`Failed to read CA file '${verifySsl}': ${error}`);
    }
  }
  return new Agent({ connect });
}

/** Options accepted by {@link sendHttpRequest}. */
export interface HttpSendOptions {
  headers?: Record<string, string> | null;
  /** Request body, already serialized to a string. */
  body?: string | null;
  params?: Record<string, any> | null;
  /** Request timeout in seconds. */
  timeoutSeconds?: number;
  dispatcher?: any;
}

/**
 * Send an HTTP request and return the raw `Response`.
 *
 * Query parameters with `undefined`/`null` values are dropped (Python
 * `requests` behavior) and array values are expanded into repeated keys.
 */
export async function sendHttpRequest(
  method: string,
  url: string,
  options: HttpSendOptions = {},
): Promise<Response> {
  // `URLSearchParams` emits form encoding (`+` for spaces, `%7E` for `~`),
  // while the AK/SK canonical query uses RFC 3986, so signing a request built
  // with it fails for any value containing a space, `~` or non-ASCII text.
  const target = appendQueryParams(url, options.params);

  const timeoutMs = Math.max(1, Math.round((options.timeoutSeconds ?? 30) * 1000));
  return fetch(target, {
    method,
    headers: options.headers ?? {},
    body: options.body ?? undefined,
    signal: AbortSignal.timeout(timeoutMs),
    dispatcher: options.dispatcher,
  } as any);
}

/**
 * Abstract authentication strategy interface.
 *
 * Python's abstract base class -> TypeScript abstract class; every method is
 * asynchronous because credentials may be loaded from the metadata service.
 */
export abstract class AuthenticationStrategy {
  credentials?: BasicCredentials;

  /** Correlation id forwarded as `X-Client-Request-ID` when set. */
  clientRequestId?: string;

  /** Set up authentication credentials. */
  abstract setupCredentials(regionName: string): Promise<void>;

  /**
   * Set up session hooks.
   *
   * Node.js has no `requests.Session`, so this is a no-op kept for parity.
   */
  setupSessionHooks(_session?: unknown): void {
    // Nothing to do: the SDK uses the global fetch API.
  }

  /** Get request headers for this strategy. */
  abstract getHeaders(): Record<string, string>;

  /** Get the endpoint type (`control` or `data`). */
  abstract getEndpointType(): string;

  /**
   * Sign the HTTP request. Strategies that need signing override this method.
   *
   * @param method HTTP method.
   * @param url Full URL.
   * @param headers Request headers (may be modified in place).
   * @param body Request body as a string.
   * @param params Query parameters.
   * @returns The updated headers.
   */
  async signRequest(
    _method: string,
    _url: string,
    headers: Record<string, string>,
    _body?: string | null,
    _params?: Record<string, any> | null,
  ): Promise<Record<string, string>> {
    return headers;
  }

  /** Release strategy resources (no-op by default). */
  async close(): Promise<void> {
    // Nothing to release.
  }
}

/** Data plane authentication strategy (API Key bearer token). */
export class DataPlaneAuthenticationStrategy extends AuthenticationStrategy {
  protected _apiKey?: string | null;

  constructor(apiKey?: string | null) {
    super();
    this.credentials = undefined;
    this._apiKey = apiKey;
  }

  override async setupCredentials(_regionName: string): Promise<void> {
    // Data plane does not require AK/SK credentials.
    this.credentials = undefined;
    logger.info(
      'Data plane endpoint: credentials will be handled via HUAWEICLOUD_SDK_MEMORY_API_KEY in headers',
    );
  }

  override setupSessionHooks(_session?: unknown): void {
    // Data plane does not require special session hooks.
  }

  override getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    const apiKey = this._apiKey || process.env[ENV_HUAWEICLOUD_SDK_MEMORY_API_KEY];
    if (!apiKey) {
      throw new Error(
        'API Key is required for data plane operations. ' +
          'Either pass apiKey parameter or set HUAWEICLOUD_SDK_MEMORY_API_KEY environment variable.',
      );
    }
    headers['Authorization'] = `Bearer ${apiKey}`;

    if (this.clientRequestId) {
      headers['X-Client-Request-ID'] = this.clientRequestId;
    }

    return headers;
  }

  override getEndpointType(): string {
    return 'data';
  }
}

/** Control plane authentication strategy (AK/SK SDK-HMAC-SHA256 signing). */
export class ControlPlaneAuthenticationStrategy extends AuthenticationStrategy {
  protected _regionName?: string;
  protected _signer?: SDKSigner;

  override async setupCredentials(regionName: string): Promise<void> {
    this._regionName = regionName;
    try {
      this.credentials = await createCredential();
      this._signer = new SDKSigner(this.credentials);
      logger.info(`Successfully loaded AK/SK credentials for region ${regionName}`);
    } catch (error) {
      throw new Error(
        'Failed to load AK/SK credentials for control plane. ' +
          'Please set HUAWEICLOUD_SDK_AK and HUAWEICLOUD_SDK_SK environment variables. ' +
          `Error: ${error}`,
      );
    }
  }

  override setupSessionHooks(_session?: unknown): void {
    // Signing happens per request; there is nothing to hook.
  }

  override getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.clientRequestId) {
      headers['X-Client-Request-ID'] = this.clientRequestId;
    }

    return headers;
  }

  override getEndpointType(): string {
    return 'control';
  }

  override async signRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | null,
    params?: Record<string, any> | null,
  ): Promise<Record<string, string>> {
    if (!this._signer) {
      return headers;
    }

    // Sign exactly what `appendQueryParams` puts on the wire: the signer does
    // not drop null/undefined, so signing raw params would add keys the URL
    // never carries. Arrays are normalized (copied, sorted) as well, keeping the
    // canonical order identical to the wire and the caller's array untouched.
    const paramsList = Object.entries(normalizeQueryParams(params));
    return this._signer.sign(method, url, headers, body ?? null, paramsList);
  }
}

/** Options accepted by {@link MemoryHttpService}. */
export interface MemoryHttpServiceOptions {
  regionName?: string | null;
  /** Custom endpoint URL (development/testing). */
  endpoint?: string | null;
  /** `control` (default) or `data`. */
  endpointType?: string;
  /** Request timeout in seconds. */
  timeout?: number;
  apiKey?: string | null;
  verifySsl?: boolean | string;
  /**
   * Whether to enable request signing. When omitted, signing is enabled for the
   * control plane and disabled for the data plane.
   */
  enableSigning?: boolean | null;
}

/** Options accepted by {@link MemoryHttpService._makeRequest}. */
export interface MakeRequestOptions {
  params?: Record<string, any> | null;
  data?: string | Record<string, any> | null;
  headers?: Record<string, string> | null;
  spaceId?: string | null;
}

/**
 * HTTP client for Huawei Memory API operations with AK/SK authentication.
 */
export class MemoryHttpService {
  regionName: string;
  /** Request timeout in seconds. */
  timeout: number;
  verifySsl: boolean | string;
  credentials?: BasicCredentials;

  protected _endpoint?: string | null;
  protected _apiKey?: string | null;
  protected _endpointType: string;
  protected _enableSigning: boolean;
  protected _authStrategy: AuthenticationStrategy;
  /** Resolves when credential setup finished (mirrors Python's eager setup). */
  protected _ready: Promise<void>;

  private _userAgent: string;
  private _dispatcher?: any;

  /**
   * @param first Options object, or the region name when using the positional
   *   form (same order as the Python signature).
   */
  constructor(
    first?: MemoryHttpServiceOptions | string | null,
    endpoint?: string | null,
    endpointType = 'control',
    timeout = 30,
    apiKey?: string | null,
    verifySsl: boolean | string = true,
    enableSigning: boolean | null = null,
  ) {
    const options: MemoryHttpServiceOptions =
      typeof first === 'object' && first !== null
        ? first
        : {
            regionName: first ?? undefined,
            endpoint: endpoint ?? undefined,
            endpointType,
            timeout,
            apiKey: apiKey ?? undefined,
            verifySsl,
            enableSigning: enableSigning ?? undefined,
          };

    this.regionName = options.regionName || getRegion();
    this._endpoint = options.endpoint;
    this.timeout = options.timeout ?? 30;
    this.verifySsl = options.verifySsl ?? true;
    this._apiKey = options.apiKey;
    this._endpointType = options.endpointType ?? 'control';

    this._enableSigning =
      options.enableSigning === undefined || options.enableSigning === null
        ? this._endpointType === 'control'
        : options.enableSigning;

    this._userAgent = buildUserAgent('');

    this._authStrategy = this._createAuthenticationStrategy(this._endpointType);

    if (this._enableSigning) {
      this._ready = this._authStrategy.setupCredentials(this.regionName);
    } else {
      this._ready = Promise.resolve();
    }
    this.credentials = this._authStrategy.credentials;

    this._authStrategy.setupSessionHooks();

    if (this.clientRequestId) {
      this._authStrategy.clientRequestId = this.clientRequestId;
    }
  }

  /** Correlation id forwarded as `X-Client-Request-ID` when set. */
  get clientRequestId(): string | undefined {
    return this._authStrategy?.clientRequestId;
  }

  set clientRequestId(value: string | undefined) {
    if (this._authStrategy) {
      this._authStrategy.clientRequestId = value;
    }
  }

  /** Create the authentication strategy for the given endpoint type. */
  protected _createAuthenticationStrategy(endpointType: string): AuthenticationStrategy {
    if (endpointType === 'data') {
      return new DataPlaneAuthenticationStrategy(this._apiKey ?? null);
    }
    return new ControlPlaneAuthenticationStrategy();
  }

  /** Get default headers for API requests. */
  _getHeaders(): Record<string, string> {
    return this._authStrategy.getHeaders();
  }

  /** Get the base URL for the given space (data plane) or control plane. */
  _getBaseUrl(spaceId?: string | null): string {
    return getMemoryEndpoint(
      this._authStrategy.getEndpointType(),
      this.regionName,
      spaceId ?? null,
    );
  }

  /** Send a prepared request, honoring `verifySsl` and the configured timeout. */
  protected async _send(
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | null,
    params: Record<string, any> | null,
  ): Promise<Response> {
    return sendHttpRequest(method, url, {
      headers,
      body,
      params,
      timeoutSeconds: this.timeout,
      dispatcher: this._getDispatcher(),
    });
  }

  private _getDispatcher(): any {
    if (this._dispatcher === undefined) {
      this._dispatcher = createHttpDispatcher(this.verifySsl);
    }
    return this._dispatcher;
  }

  /**
   * Make an HTTP request to the Memory API.
   *
   * @throws {MemoryAPIException} If the API request fails.
   */
  async _makeRequest(
    method: string,
    path: string,
    options: MakeRequestOptions = {},
  ): Promise<any> {
    // Python performs credential setup in the constructor; the Node.js port
    // cannot await there, so surface the failure on the first request.
    await this._ready;
    this.credentials = this._authStrategy.credentials;

    const baseUrl = this._getBaseUrl(options.spaceId ?? null);
    const url = `${baseUrl}${path}`;
    const params = options.params ?? null;

    let finalHeaders: Record<string, string> = { ...this._getHeaders() };
    if (options.headers) {
      Object.assign(finalHeaders, options.headers);
    }

    let body: string | null = null;
    const data = options.data;
    if (data !== undefined && data !== null) {
      body = typeof data === 'string' ? data : JSON.stringify(data);
    }

    if (this._enableSigning) {
      finalHeaders = await this._authStrategy.signRequest(
        method,
        url,
        finalHeaders,
        body,
        params,
      );
    }

    // The User-Agent is added by the transport in Python (session headers), so
    // it is intentionally not part of the signature.
    if (!finalHeaders['User-Agent']) {
      finalHeaders['User-Agent'] = this._userAgent;
    }

    try {
      const response = await this._send(method, url, finalHeaders, body, params);
      const statusCode = response.status;
      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();

      if (statusCode === 200 || statusCode === 201) {
        if (contentType.startsWith('application/json')) {
          try {
            return JSON.parse(text);
          } catch (error) {
            // 2xx but the body is not valid JSON: a parse error, not a network
            // error (distinguished by error_code).
            const parseError = new MemoryAPIException(
              statusCode,
              'PARSE_ERROR',
              `Failed to parse JSON response: ${error}`,
            );
            parseError.cause = error;
            throw parseError;
          }
        }
        return { response: text };
      }

      if (statusCode === 204) {
        return {};
      }

      let errorCode = 'UNKNOWN_ERROR';
      let errorMsg = text || `HTTP ${statusCode}`;
      try {
        const errorData = JSON.parse(text);
        errorCode = errorData?.error_code ?? 'UNKNOWN_ERROR';
        errorMsg = errorData?.error_msg ?? JSON.stringify(errorData);
      } catch {
        errorCode = 'UNKNOWN_ERROR';
        errorMsg = text || `HTTP ${statusCode}`;
      }

      throw new MemoryAPIException(statusCode, errorCode, errorMsg);
    } catch (error) {
      if (error instanceof MemoryAPIException) {
        throw error;
      }
      logger.warning(`Network request failed: ${error}`);
      // statusCode 0 = no HTTP response (aligned with BaseHTTPClient).
      const networkError = new MemoryAPIException(0, 'NETWORK_ERROR', String(error));
      // Keep the original exception chain accessible (Python `__cause__`).
      networkError.cause = error;
      throw networkError;
    }
  }

  /** Create a new memory space. */
  async createSpace(data: Record<string, any>): Promise<Record<string, any>> {
    return this._makeRequest('POST', '/v1/core/spaces', { data });
  }

  /** Create a new API Key. */
  async createApiKey(): Promise<Record<string, any>> {
    return this._makeRequest('POST', '/v1/core/space-keys');
  }

  /** Get space information by ID. */
  async getSpace(spaceId: string): Promise<Record<string, any>> {
    return this._makeRequest('GET', `/v1/core/spaces/${spaceId}`);
  }

  /** Update space information. */
  async updateSpace(
    spaceId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest('PUT', `/v1/core/spaces/${spaceId}`, { data });
  }

  /** Delete a space. */
  async deleteSpace(spaceId: string): Promise<Record<string, any>> {
    return this._makeRequest('DELETE', `/v1/core/spaces/${spaceId}`);
  }

  /** List all spaces. */
  async listSpaces(limit = 20, offset = 0): Promise<Record<string, any>> {
    return this._makeRequest('GET', '/v1/core/spaces', {
      params: { limit, offset },
    });
  }

  /** Create a new memory session. */
  async createSession(
    spaceId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest('POST', `/v1/core/spaces/${spaceId}/sessions`, {
      data,
      spaceId,
    });
  }

  /** List sessions in a space. */
  async listSessions(
    spaceId: string,
    actorId?: string | null,
    limit?: number | null,
    offset?: number | null,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {};
    if (actorId !== undefined && actorId !== null) {
      params['actor_id'] = actorId;
    }
    if (limit !== undefined && limit !== null) {
      params['limit'] = limit;
    }
    if (offset !== undefined && offset !== null) {
      params['offset'] = offset;
    }

    return this._makeRequest('GET', `/v1/core/spaces/${spaceId}/sessions`, {
      params,
      spaceId,
    });
  }

  /** Get session information. */
  async getSession(spaceId: string, sessionId: string): Promise<Record<string, any>> {
    return this._makeRequest(
      'GET',
      `/v1/core/spaces/${spaceId}/sessions/${sessionId}`,
      { spaceId },
    );
  }

  /** Delete a session (soft delete). */
  async deleteSession(spaceId: string, sessionId: string): Promise<void> {
    await this._makeRequest(
      'DELETE',
      `/v1/core/spaces/${spaceId}/sessions/${sessionId}`,
      { spaceId },
    );
  }

  /** Add messages to a session. */
  async addMessages(
    spaceId: string,
    sessionId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest(
      'POST',
      `/v1/core/spaces/${spaceId}/sessions/${sessionId}/messages`,
      { data, spaceId },
    );
  }

  /** List messages in a space or session. */
  async listMessages(
    spaceId: string,
    sessionId?: string | null,
    limit = 10,
    offset = 0,
    filters?: Record<string, any> | null,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {};
    if (typeof limit === 'number' && limit > 0) {
      params['limit'] = limit;
    }
    if (typeof offset === 'number' && offset >= 0) {
      params['offset'] = offset;
    }
    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          params[key] = value;
        }
      }
    }

    const path = `/v1/core/spaces/${spaceId}/sessions/${sessionId}/messages`;

    return this._makeRequest('GET', path, { params, spaceId });
  }

  /** Search memories in a space. */
  async searchMemories(
    spaceId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest(
      'POST',
      `/v1/core/spaces/${spaceId}/memories/search`,
      { data, spaceId },
    );
  }

  /** Get a specific memory item. */
  async getMemory(spaceId: string, memoryId: string): Promise<Record<string, any>> {
    return this._makeRequest(
      'GET',
      `/v1/core/spaces/${spaceId}/memories/${memoryId}`,
      { spaceId },
    );
  }

  /** Create a new memory item. */
  async createMemory(
    spaceId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest('POST', `/v1/core/spaces/${spaceId}/memories`, {
      data,
      spaceId,
    });
  }

  /** Update a memory item. */
  async updateMemory(
    spaceId: string,
    memoryId: string,
    data: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this._makeRequest(
      'PUT',
      `/v1/core/spaces/${spaceId}/memories/${memoryId}`,
      { data, spaceId },
    );
  }

  /** Delete a memory item. */
  async deleteMemory(spaceId: string, memoryId: string): Promise<Record<string, any>> {
    return this._makeRequest(
      'DELETE',
      `/v1/core/spaces/${spaceId}/memories/${memoryId}`,
      { spaceId },
    );
  }

  /** Get a specific message. */
  async getMessage(
    spaceId: string,
    sessionId: string,
    messageId: string,
  ): Promise<Record<string, any>> {
    return this._makeRequest(
      'GET',
      `/v1/core/spaces/${spaceId}/sessions/${sessionId}/messages/${messageId}`,
      { spaceId },
    );
  }

  /** List all memories in a space. */
  async listMemories(
    spaceId: string,
    limit?: number | null,
    offset?: number | null,
    filters?: Record<string, any> | null,
  ): Promise<Record<string, any>> {
    const params: Record<string, any> = {};
    if (limit !== undefined && limit !== null) {
      params['limit'] = limit;
    }
    if (offset !== undefined && offset !== null) {
      params['offset'] = offset;
    }

    if (filters) {
      const filterMappings = [
        'strategy_type',
        'strategy_id',
        'actor_id',
        'assistant_id',
        'session_id',
        'start_time',
        'end_time',
      ];

      for (const filterKey of filterMappings) {
        if (filterKey in filters && filters[filterKey] !== undefined && filters[filterKey] !== null) {
          params[filterKey] = filters[filterKey];
        }
      }
    }

    return this._makeRequest('GET', `/v1/core/spaces/${spaceId}/memories`, {
      params,
      spaceId,
    });
  }

  /** Get the current endpoint. */
  get endpoint(): string {
    if (this._endpoint) {
      return this._endpoint.replace(/\/+$/, '');
    }
    return getMemoryEndpoint(
      this._authStrategy.getEndpointType(),
      this.regionName,
    ).replace(/\/+$/, '');
  }

  /** Get the region. */
  get region(): string {
    return this.regionName;
  }

  /** Get the endpoint type. */
  get endpointType(): string {
    return this._endpointType;
  }

  /** Whether signing is enabled. */
  get enableSigning(): boolean {
    return this._enableSigning;
  }

  /**
   * Close the HTTP client and release resources.
   *
   * The global fetch API keeps no session, but a custom dispatcher (created for
   * `verifySsl`) is released here.
   */
  async close(): Promise<void> {
    await this._ready.catch(() => undefined);
    if (this._dispatcher) {
      const dispatcher = this._dispatcher;
      this._dispatcher = undefined;
      if (typeof dispatcher.close === 'function') {
        await dispatcher.close().catch(() => undefined);
      }
    }
    logger.info('MemoryHttpService session closed');
  }
}

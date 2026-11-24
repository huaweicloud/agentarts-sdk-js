/**
 * Base HTTP Client Module.
 *
 * Provides a base HTTP client for API calls. Other service implementations
 * inherit from BaseHTTPClient to make HTTP requests.
 *
 * The client automatically detects streaming responses based on the response
 * `Content-Type` header:
 *
 * - **Regular** (JSON / text): `data` is a parsed object or string.
 * - **Streaming** (`text/event-stream`): `data` is `null`; use `iterLines()`
 *   or `iterBytes()` to consume the body incrementally.
 */

import { readFileSync } from 'node:fs';
import { Agent, ProxyAgent } from 'undici';
import type { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';

import { getLogger } from '../utils/logging.js';
import { SDKSigner } from '../utils/signer.js';
import { V11Signer } from '../utils/signer-v11.js';
import { buildUserAgent } from '../utils/user-agent.js';
import { createCredential } from '../utils/metadata.js';

const logger = getLogger('sdk.service.http_client');

const STREAM_CONTENT_TYPES = ['text/event-stream', 'application/x-ndjson'];

/** Exception for API errors. */
export class APIException extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly errorMsg: string;

  constructor(statusCode: number, errorCode: string, errorMsg: string) {
    super(`[${errorCode}] HTTP ${statusCode}: ${errorMsg}`);
    this.name = 'APIException';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.errorMsg = errorMsg;
  }
}

/** Custom exception for Memory API errors. */
export class MemoryAPIException extends APIException {
  constructor(statusCode: number, errorCode: string, errorMsg: string) {
    super(statusCode, errorCode, errorMsg);
    this.name = 'MemoryAPIException';
  }

  /** True when the request never received a server response (network failure). */
  get isNetworkError(): boolean {
    return this.statusCode === 0 && this.errorCode === 'NETWORK_ERROR';
  }

  /** Whether a retry is recommended: network error, 429 throttling, 5xx. */
  get retryable(): boolean {
    return this.isNetworkError || [429, 500, 502, 503, 504].includes(this.statusCode);
  }
}

/** Signature mode for AK/SK authentication. */
export enum SignMode {
  SDK_HMAC_SHA256 = 'sdk',
  V11_HMAC_SHA256 = 'v11',
}

/** Configuration for HTTP requests. */
export class RequestConfig {
  baseUrl = '';
  /** Request timeout in seconds. */
  timeout = 30.0;
  headers: Record<string, string> = {};
  /**
   * SSL verification setting.
   * - `true`: verify certificates using the system CA bundle (default)
   * - `false`: skip verification (not recommended for production)
   * - `string`: path to a custom CA certificate file
   */
  verifySsl: boolean | string = true;

  constructor(init?: Partial<RequestConfig>) {
    Object.assign(this, init ?? {});
  }
}

export interface RequestResultInit {
  success: boolean;
  statusCode: number;
  data?: any;
  error?: string | null;
  headers?: Record<string, string>;
  streaming?: boolean;
  rawResponse?: Response;
}

/** Result of an HTTP request. */
export class RequestResult {
  success: boolean;
  statusCode: number;
  data: any;
  error: string | null;
  headers: Record<string, string>;
  streaming: boolean;
  private _rawResponse?: Response;

  constructor(init: RequestResultInit) {
    this.success = init.success;
    this.statusCode = init.statusCode;
    this.data = init.data ?? null;
    this.error = init.error ?? null;
    this.headers = init.headers ?? {};
    this.streaming = init.streaming ?? false;
    this._rawResponse = init.rawResponse;
  }

  /**
   * Iterate over decoded text lines.
   *
   * Only valid for streaming results. Each yielded value is a single line
   * without the trailing newline.
   */
  async *iterLines(): AsyncGenerator<string> {
    if (!this.streaming || !this._rawResponse?.body) {
      throw new Error('iterLines() is only available for streaming results');
    }
    const reader = this._rawResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          yield line;
          index = buffer.indexOf('\n');
        }
      }
      if (buffer) {
        yield buffer;
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Iterate over raw byte chunks.
   *
   * Only valid for streaming results.
   */
  async *iterBytes(): AsyncGenerator<Uint8Array> {
    if (!this.streaming || !this._rawResponse?.body) {
      throw new Error('iterBytes() is only available for streaming results');
    }
    const reader = this._rawResponse.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value && value.length > 0) {
          yield value;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Close the underlying HTTP response (streaming only). */
  close(): void {
    if (this._rawResponse?.body) {
      void this._rawResponse.body.cancel().catch(() => undefined);
      this._rawResponse = undefined;
    }
  }
}

export interface RequestOptions {
  params?: Record<string, any>;
  headers?: Record<string, string>;
  json?: any;
  data?: any;
  files?: Record<string, any>;
  /** Timeout in seconds. */
  timeout?: number;
  /** Force streaming mode. */
  stream?: boolean;
}

/**
 * Base HTTP client for making API calls.
 *
 * Subclass this to implement service-specific API clients.
 */
export class BaseHTTPClient {
  protected _config: RequestConfig;
  protected _openAkSk: boolean;
  protected _signMode: SignMode;
  protected _regionId: string;
  protected _credentials?: BasicCredentials;
  protected _sdkSigner?: SDKSigner;
  private _defaultHeaders: Record<string, string>;
  private _dispatcher?: any;

  constructor(
    config?: RequestConfig | null,
    openAkSk = false,
    signMode: SignMode = SignMode.SDK_HMAC_SHA256,
    regionId = '',
  ) {
    this._config = config ?? new RequestConfig();
    this._openAkSk = openAkSk;
    this._signMode = signMode;
    this._regionId = regionId;
    this._defaultHeaders = { ...this._config.headers };
    this._defaultHeaders['User-Agent'] = buildUserAgent(this._defaultHeaders['User-Agent'] ?? '');
  }

  protected _getSecurityToken(): string | undefined {
    const credentials: any = this._credentials;
    if (!credentials) {
      return undefined;
    }
    return credentials.securityToken ?? credentials.security_token ?? undefined;
  }

  /** Sign the request using V11-HMAC-SHA256 (without body). */
  protected async _signRequestV11(
    method: string,
    fullUrl: string,
    options: RequestOptions,
  ): Promise<RequestOptions> {
    if (!this._credentials) {
      this._credentials = await createCredential();
    }
    if (!this._regionId) {
      throw new Error('region_id is required for V11-HMAC-SHA256 signing');
    }

    const parsed = new URL(fullUrl);
    const host = parsed.host;
    const path = parsed.pathname || '/';

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    headers['host'] = host;
    headers['x-sdk-content-sha256'] = 'UNSIGNED-PAYLOAD';

    if (options.data !== undefined && options.data !== null) {
      if (typeof options.data === 'object') {
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
      }
    } else if (options.json !== undefined && options.json !== null) {
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }

    const securityToken = this._getSecurityToken();
    if (securityToken) {
      headers['X-Security-Token'] = securityToken;
    }

    const signer = new V11Signer(this._credentials.ak ?? '', this._credentials.sk ?? '', this._regionId);
    const signed = signer.sign(method, path, options.params, headers);

    logger.debug(`V11 request: ${method} ${fullUrl} params=${JSON.stringify(options.params)}`);

    return { ...options, headers: signed };
  }

  /** Sign the request using SDK-HMAC-SHA256 (with body). */
  protected async _signRequestSdk(
    method: string,
    fullUrl: string,
    options: RequestOptions,
  ): Promise<RequestOptions> {
    if (!this._sdkSigner) {
      this._credentials = this._credentials ?? (await createCredential());
      this._sdkSigner = new SDKSigner(this._credentials);
    }

    const headers: Record<string, string> = { ...(options.headers ?? {}) };
    let body: string | null = null;

    if (options.files !== undefined) {
      headers['x-sdk-content-sha256'] = 'UNSIGNED-PAYLOAD';
    } else if (options.data !== undefined && options.data !== null) {
      if (typeof options.data === 'object') {
        body = new URLSearchParams(options.data as Record<string, any>).toString();
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
      } else {
        body = String(options.data);
      }
    } else if (options.json !== undefined && options.json !== null) {
      body = JSON.stringify(options.json);
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }

    const paramsList = options.params ? Object.entries(options.params) : undefined;
    const signedHeaders = await this._sdkSigner.sign(method, fullUrl, headers, body, paramsList);

    return { ...options, headers: signedHeaders };
  }

  /** Sign the request using AK/SK based on `signMode`. */
  protected async _signRequest(
    method: string,
    fullUrl: string,
    options: RequestOptions,
  ): Promise<RequestOptions> {
    if (this._signMode === SignMode.V11_HMAC_SHA256) {
      return this._signRequestV11(method, fullUrl, options);
    }
    return this._signRequestSdk(method, fullUrl, options);
  }

  private _getDispatcher(): any {
    const verifySsl = this._config.verifySsl;
    if (verifySsl === true) {
      return undefined;
    }
    if (!this._dispatcher) {
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
      this._dispatcher = new Agent({ connect });
    }
    return this._dispatcher;
  }

  private _buildUrl(url: string): string {
    const fullUrl = `${this._config.baseUrl}${url}`;
    try {
      return new URL(fullUrl).toString();
    } catch {
      // Relative URLs / empty baseUrl: let fetch surface the error.
      return fullUrl;
    }
  }

  /**
   * Execute an HTTP request and return a RequestResult.
   */
  protected async _request(method: string, url: string, options: RequestOptions = {}): Promise<RequestResult> {
    let workingOptions: RequestOptions = { ...options };
    const fullUrl = this._buildUrl(url);

    try {
      if (this._openAkSk) {
        workingOptions = await this._signRequest(method, fullUrl, workingOptions);
      }
    } catch (error) {
      return new RequestResult({
        success: false,
        statusCode: 0,
        error: `Unexpected error: ${error}`,
      });
    }

    const headers: Record<string, string> = {
      ...this._defaultHeaders,
      ...(workingOptions.headers ?? {}),
    };

    let body: any;
    if (workingOptions.files) {
      const form = new FormData();
      for (const [name, value] of Object.entries(workingOptions.files)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            form.append(name, item as any);
          }
        } else {
          form.append(name, value as any);
        }
      }
      body = form;
    } else if (workingOptions.data !== undefined && workingOptions.data !== null) {
      if (isBinaryBody(workingOptions.data) || workingOptions.data instanceof FormData) {
        body = workingOptions.data;
        if (workingOptions.data instanceof FormData) {
          delete headers['Content-Type'];
          delete headers['content-type'];
        }
      } else if (typeof workingOptions.data === 'object') {
        body = new URLSearchParams(workingOptions.data as Record<string, any>).toString();
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/x-www-form-urlencoded';
      } else {
        body = workingOptions.data;
      }
    } else if (workingOptions.json !== undefined && workingOptions.json !== null) {
      body = JSON.stringify(workingOptions.json);
      headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
    }

    const timeoutMs = (workingOptions.timeout ?? this._config.timeout) * 1000;
    const requestUrl = appendQueryParams(fullUrl, workingOptions.params);

    try {
      const response = await fetch(requestUrl, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: this._getDispatcher(),
      } as any);

      const contentType = response.headers.get('content-type') ?? '';
      const isStream =
        workingOptions.stream === true ||
        STREAM_CONTENT_TYPES.some((streamType) => contentType.includes(streamType));

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      if (isStream) {
        return new RequestResult({
          success: response.ok,
          statusCode: response.status,
          data: null,
          headers: responseHeaders,
          streaming: true,
          rawResponse: response,
        });
      }

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
        if (data !== null && typeof data === 'object') {
          errorMsg =
            (data as any).error || (data as any).message || (data as any).error_msg || text;
        } else {
          errorMsg = text || `HTTP ${response.status}`;
        }
      }

      return new RequestResult({
        success: response.ok,
        statusCode: response.status,
        data,
        error: errorMsg,
        headers: responseHeaders,
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

  /** Send GET request. */
  async get(url: string, params?: Record<string, any>, options: RequestOptions = {}): Promise<RequestResult> {
    if (params) {
      options.params = params;
    }
    return this._request('GET', url, options);
  }

  /** Send POST request. */
  async post(url: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._request('POST', url, options);
  }

  /** Send PUT request. */
  async put(url: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._request('PUT', url, options);
  }

  /** Send PATCH request. */
  async patch(url: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._request('PATCH', url, options);
  }

  /** Send DELETE request. */
  async delete(url: string, options: RequestOptions = {}): Promise<RequestResult> {
    return this._request('DELETE', url, options);
  }

  /** Send request with custom HTTP method. */
  async request(
    method: string,
    url: string,
    options: RequestOptions = {},
  ): Promise<RequestResult> {
    return this._request(method, url, options);
  }

  /** Set default header for all subsequent requests. */
  setHeader(key: string, value: string): void {
    this._config.headers[key] = value;
    this._defaultHeaders[key] = value;
  }

  /** Set authorization token for all subsequent requests. */
  setAuthToken(token: string, scheme = 'Bearer'): void {
    this.setHeader('Authorization', `${scheme} ${token}`);
  }

  /** Remove authorization header. */
  clearAuth(): void {
    delete this._config.headers['Authorization'];
    delete this._defaultHeaders['Authorization'];
  }

  /** Close the underlying HTTP client. */
  close(): void {
    this._dispatcher = undefined;
  }
}

function isBinaryBody(value: any): boolean {
  return (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof ReadableStream !== 'undefined' && value instanceof ReadableStream)
  );
}

/**
 * RFC 3986 percent-encoding.
 *
 * `encodeURIComponent` leaves `! ' ( ) *` unescaped, while the canonical query
 * of the AK/SK signers escapes them (`%21`, `%27`, ...), and it must never
 * produce the form-style `+` for spaces. Any mismatch here makes the server
 * recompute a different canonical request and reject the signature.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Append query parameters to a URL (RFC 3986 encoding, repeated keys for arrays). */
function appendQueryParams(url: string, params?: Record<string, any>): string {
  if (!params) {
    return url;
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item !== undefined && item !== null) {
        parts.push(`${encodeRfc3986(key)}=${encodeRfc3986(String(item))}`);
      }
    }
  }
  if (parts.length === 0) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${parts.join('&')}`;
}

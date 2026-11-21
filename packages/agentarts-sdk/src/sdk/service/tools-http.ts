/**
 * AgentArts Tools HTTP Client.
 *
 * Mirrors `agentarts/sdk/service/tools_http.py`: low-level control-plane and
 * data-plane clients for the Code Interpreter and Browser services.
 *
 * Control plane  (AK/SK signed):
 *   - Code Interpreter lifecycle (create, list, update, get, delete)
 *   - Browser lifecycle (create, list, update, get, delete)
 *   - Browser profile lifecycle (create, list, get, delete)
 *
 * Data plane:
 *   - Code Interpreter session lifecycle (start, stop, get, invoke)
 *   - Browser session lifecycle (start, stop, get, invoke, streams, profile)
 */

import { randomBytes } from 'node:crypto';

import { BaseHTTPClient, RequestConfig, RequestResult, SignMode } from './http-client.js';

const ENV_HUAWEICLOUD_SDK_BROWSER_API_KEY = 'HUAWEICLOUD_SDK_BROWSER_API_KEY';

/**
 * Error raised when a Tools API request fails.
 *
 * Mirrors Python `ToolsAPIError` (`status_code`, `error_msg`).
 */
export class ToolsAPIError extends Error {
  readonly statusCode: number;
  readonly errorMsg: string;

  constructor(statusCode: number, errorMsg: string) {
    super(`Tools API Error: ${errorMsg}`);
    this.name = 'ToolsAPIError';
    this.statusCode = statusCode;
    this.errorMsg = errorMsg;
  }
}

/** Unwrap a successful {@link RequestResult} or raise {@link ToolsAPIError}. */
function _unwrap(response: RequestResult): Record<string, any> {
  if (!response.success) {
    throw new ToolsAPIError(response.statusCode, response.error ?? '');
  }
  return response.data as Record<string, any>;
}

/**
 * Control plane HTTP client for code interpreters.
 *
 * Manages code interpreter resources. Uses AK/SK signing for authentication.
 */
export class ControlToolsHttpClient extends BaseHTTPClient {
  readonly regionName: string;

  constructor(regionName: string, endpointUrl: string, verifySsl: boolean | string = true) {
    super(new RequestConfig({ baseUrl: endpointUrl, verifySsl }), true);
    this.regionName = regionName;
  }

  /** POST /v1/core/code-interpreters — create a code interpreter. */
  async createCodeInterpreter(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.post('/v1/core/code-interpreters', { json: requestParams });
    return _unwrap(response);
  }

  /** GET /v1/core/code-interpreters — list all code interpreters. */
  async listCodeInterpreters(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.get('/v1/core/code-interpreters', requestParams);
    return _unwrap(response);
  }

  /** PUT /v1/core/code-interpreters/{code_interpreter_id} — update a code interpreter. */
  async updateCodeInterpreter(
    codeInterpreterId: string,
    requestParams: Record<string, any>,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/core/code-interpreters/${codeInterpreterId}`;
    const response = await this.put(endpoint, { json: requestParams });
    return _unwrap(response);
  }

  /** GET /v1/core/code-interpreters/{code_interpreter_id} — get code interpreter details. */
  async getCodeInterpreter(codeInterpreterId: string): Promise<Record<string, any>> {
    const endpoint = `/v1/core/code-interpreters/${codeInterpreterId}`;
    const response = await this.get(endpoint);
    return _unwrap(response);
  }

  /** DELETE /v1/core/code-interpreters/{code_interpreter_id} — delete a code interpreter. */
  async deleteCodeInterpreter(codeInterpreterId: string): Promise<void> {
    const endpoint = `/v1/core/code-interpreters/${codeInterpreterId}`;
    const response = await this.delete(endpoint);
    _unwrap(response);
  }
}

/**
 * Data plane HTTP client for code interpreter sessions.
 *
 * Supports IAM (V11-HMAC-SHA256 signing) and API_KEY (Bearer token)
 * authentication.
 */
export class DataToolsHttpClient extends BaseHTTPClient {
  readonly regionName: string;

  constructor(
    regionName: string,
    endpointUrl: string,
    authType = 'API_KEY',
    verifySsl: boolean | string = true,
  ) {
    if (authType === 'IAM') {
      super(
        new RequestConfig({ baseUrl: endpointUrl, verifySsl }),
        true,
        SignMode.V11_HMAC_SHA256,
        regionName,
      );
    } else {
      super(new RequestConfig({ baseUrl: endpointUrl, verifySsl }));
    }
    this.regionName = regionName;
  }

  /** Whether AK/SK signing is enabled (Python `open_ak_sk` property). */
  get openAkSk(): boolean {
    return this._openAkSk;
  }

  set openAkSk(openAkSk: boolean) {
    this._openAkSk = openAkSk;
  }

  /** PUT /v1/code-interpreters/{code_interpreter_name}/sessions-start — start a session. */
  async startSession(
    codeInterpreterName: string,
    requestParams: Record<string, any>,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/code-interpreters/${codeInterpreterName}/sessions-start`;
    const headers: Record<string, string> = {};
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.put(endpoint, { json: requestParams, headers });
    return _unwrap(response);
  }

  /** PUT /v1/code-interpreters/{code_interpreter_name}/sessions-stop — stop a session. */
  async stopSession(
    codeInterpreterName: string,
    sessionId: string,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/code-interpreters/${codeInterpreterName}/sessions-stop`;
    const headers: Record<string, string> = {
      'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.put(endpoint, { headers });
    return _unwrap(response);
  }

  /** GET /v1/code-interpreters/{code_interpreter_name}/sessions-get — get session details. */
  async getSession(
    codeInterpreterName: string,
    sessionId: string,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/code-interpreters/${codeInterpreterName}/sessions-get`;
    const headers: Record<string, string> = {
      'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.get(endpoint, undefined, { headers });
    return _unwrap(response);
  }

  /** POST /v1/code-interpreters/{code_interpreter_name}/invoke — invoke a session. */
  async invoke(
    codeInterpreterName: string,
    sessionId: string,
    arguments_: Record<string, any> | null = null,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/code-interpreters/${codeInterpreterName}/invoke`;
    const headers: Record<string, string> = {
      'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.post(endpoint, { headers, json: arguments_ });
    return _unwrap(response);
  }
}

/**
 * Browser control plane HTTP client.
 *
 * Manages browser resources and browser profiles through the control plane
 * API. Uses AK/SK signing for authentication.
 */
export class ControlBrowserHttpClient extends BaseHTTPClient {
  readonly regionName: string;

  constructor(regionName: string, endpointUrl: string, verifySsl: boolean | string = true) {
    super(new RequestConfig({ baseUrl: endpointUrl, verifySsl }), true);
    this.regionName = regionName;
  }

  // ── Browser resource CRUD ──────────────────────────────────────────

  /** POST /v1/core/browsers — create a browser resource. */
  async createBrowser(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.post('/v1/core/browsers', { json: requestParams });
    return _unwrap(response);
  }

  /** GET /v1/core/browsers — list browser resources. */
  async listBrowsers(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.get('/v1/core/browsers', requestParams);
    return _unwrap(response);
  }

  /** PUT /v1/core/browsers/{browser_id} — update a browser resource. */
  async updateBrowser(
    browserId: string,
    requestParams: Record<string, any>,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/core/browsers/${browserId}`;
    const response = await this.put(endpoint, { json: requestParams });
    return _unwrap(response);
  }

  /** GET /v1/core/browsers/{browser_id} — get browser resource details. */
  async getBrowser(browserId: string): Promise<Record<string, any>> {
    const endpoint = `/v1/core/browsers/${browserId}`;
    const response = await this.get(endpoint);
    return _unwrap(response);
  }

  /** DELETE /v1/core/browsers/{browser_id} — delete a browser resource. */
  async deleteBrowser(browserId: string): Promise<void> {
    const endpoint = `/v1/core/browsers/${browserId}`;
    const response = await this.delete(endpoint);
    _unwrap(response);
  }

  // ── Browser profile CRUD ───────────────────────────────────────────

  /** POST /v1/core/browser-profiles — create a browser profile. */
  async createBrowserProfile(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.post('/v1/core/browser-profiles', { json: requestParams });
    return _unwrap(response);
  }

  /** GET /v1/core/browser-profiles — list browser profiles. */
  async listBrowserProfiles(requestParams: Record<string, any>): Promise<Record<string, any>> {
    const response = await this.get('/v1/core/browser-profiles', requestParams);
    return _unwrap(response);
  }

  /** GET /v1/core/browser-profiles/{profile_id} — get browser profile details. */
  async getBrowserProfile(profileId: string): Promise<Record<string, any>> {
    const endpoint = `/v1/core/browser-profiles/${profileId}`;
    const response = await this.get(endpoint);
    return _unwrap(response);
  }

  /** DELETE /v1/core/browser-profiles/{profile_id} — delete a browser profile. */
  async deleteBrowserProfile(profileId: string): Promise<void> {
    const endpoint = `/v1/core/browser-profiles/${profileId}`;
    const response = await this.delete(endpoint);
    _unwrap(response);
  }
}

/**
 * Browser data plane HTTP client.
 *
 * Manages browser sessions and operation execution through the data plane API.
 * Supports IAM (V11-HMAC-SHA256 signing) and API_KEY (Bearer token)
 * authentication.
 */
export class DataBrowserHttpClient extends BaseHTTPClient {
  readonly regionName: string;

  constructor(
    regionName: string,
    endpointUrl: string,
    authType = 'API_KEY',
    verifySsl: boolean | string = true,
  ) {
    if (authType === 'IAM') {
      super(
        new RequestConfig({ baseUrl: endpointUrl, verifySsl }),
        true,
        SignMode.V11_HMAC_SHA256,
        regionName,
      );
    } else {
      super(new RequestConfig({ baseUrl: endpointUrl, verifySsl }));
    }
    this.regionName = regionName;
  }

  /** Whether AK/SK signing is enabled (Python `open_ak_sk` property). */
  get openAkSk(): boolean {
    return this._openAkSk;
  }

  set openAkSk(openAkSk: boolean) {
    this._openAkSk = openAkSk;
  }

  /** PUT /v1/browsers/{browser_name}/sessions-start — start a browser session. */
  async startSession(
    browserName: string,
    requestParams: Record<string, any>,
    sessionId: string | null = null,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/sessions-start`;
    const headers: Record<string, string> = {};
    if (sessionId != null) {
      headers['X-hw-Agentarts-Browser-Session-Id'] = sessionId;
    }
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.put(endpoint, { json: requestParams, headers });
    return _unwrap(response);
  }

  /** PUT /v1/browsers/{browser_name}/sessions-stop — stop a browser session. */
  async stopSession(
    browserName: string,
    sessionId: string,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/sessions-stop`;
    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.put(endpoint, { headers });
    return _unwrap(response);
  }

  /** GET /v1/browsers/{browser_name}/sessions-get — get browser session details. */
  async getSession(
    browserName: string,
    sessionId: string,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/sessions-get`;
    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await this.get(endpoint, undefined, { headers });
    return _unwrap(response);
  }

  /** POST /v1/browsers/{browser_name}/invoke — invoke a browser session operation. */
  async invoke(
    browserName: string,
    sessionId: string,
    type: string,
    action: Record<string, any>,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/invoke`;
    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestParams = { type, action };

    const response = await this.post(endpoint, { headers, json: requestParams });
    return _unwrap(response);
  }

  /** PUT /v1/browsers/{browser_name}/streams-update — update a session stream. */
  async updateStream(
    browserName: string,
    sessionId: string,
    streamStatus: string,
    clientToken: string | null = null,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/streams-update`;
    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const requestParams: Record<string, any> = {
      stream_update: { automation_stream_update: { stream_status: streamStatus } },
    };
    if (clientToken != null) {
      requestParams['client_token'] = clientToken;
    }

    const response = await this.put(endpoint, { headers, json: requestParams });
    return _unwrap(response);
  }

  /** PUT /v1/browsers/{browser_name}/save-profile — save session state to a profile. */
  async saveProfile(
    browserName: string,
    sessionId: string,
    profileId: string,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    const endpoint = `/v1/browsers/${browserName}/save-profile`;
    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
      'X-HW-AgentArts-Browser-Profile-Id': profileId,
    };
    if (apiKey != null) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await this.put(endpoint, { headers });
    return _unwrap(response);
  }

  /**
   * Build WebSocket connection headers with auth and session info.
   *
   * For IAM auth, converts the WebSocket URL to an HTTP URL and signs it using
   * V11-HMAC-SHA256, then merges the signed headers. For API_KEY auth, adds
   * `Authorization: Bearer <api_key>`.
   *
   * Python's `build_ws_headers` is synchronous because the signer is
   * synchronous there; in Node.js the credential lookup is asynchronous, so
   * this method returns a Promise.
   */
  async buildWsHeaders(
    sessionId: string,
    wsUrl: string,
    apiKey: string | null = null,
  ): Promise<Record<string, string>> {
    const wsKey = randomBytes(16).toString('base64');

    const headers: Record<string, string> = {
      'X-hw-Agentarts-Browser-Session-Id': sessionId,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': wsKey,
    };

    if (this.openAkSk) {
      // IAM mode: convert ws(s):// → http(s):// and sign with V11.
      const httpUrl = wsUrl.replace('wss://', 'https://').replace('ws://', 'http://');
      const signedResult = await this._signRequestV11('GET', httpUrl, {});
      const iamHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(signedResult.headers ?? {})) {
        iamHeaders[key.toLowerCase()] = value;
      }
      Object.assign(headers, iamHeaders);
    } else {
      const resolvedApiKey = apiKey || process.env[ENV_HUAWEICLOUD_SDK_BROWSER_API_KEY];
      if (!resolvedApiKey) {
        throw new Error('API Key is not provided and not found in environment variable.');
      }
      headers['Authorization'] = `Bearer ${resolvedApiKey}`;
    }

    return headers;
  }
}

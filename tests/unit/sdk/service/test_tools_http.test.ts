/**
 * Tests for the Tools HTTP clients.
 *
 * Ported 1:1 from `tests/unit/sdk/service/test_tools_http.py`.
 *
 * Python patches `post`/`get`/`put`/`delete` on the client classes
 * (`@patch.object(ControlToolsHttpClient, "post")`); the Node.js port spies on
 * the same methods inherited from `BaseHTTPClient` and returns a real
 * `RequestResult`. No request ever reaches `fetch`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestResult } from 'agentarts-sdk/sdk/service/http-client';
import {
  ControlBrowserHttpClient,
  ControlToolsHttpClient,
  DataBrowserHttpClient,
  DataToolsHttpClient,
} from 'agentarts-sdk/sdk/service/tools-http';

/** Build a successful `RequestResult`, mirroring the Python test fixtures. */
function okResult(data: any, statusCode = 200): RequestResult {
  return new RequestResult({
    success: true,
    statusCode,
    data,
    headers: {},
    streaming: true,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // Unit tests must never reach the network (PORTING.md §10): the request
  // methods are spied below, so any `fetch` call would be a test bug.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('unexpected fetch call'))),
  );
});

describe('TestToolsHttpClient', () => {
  let controlClient: ControlToolsHttpClient;
  let dataClient: DataToolsHttpClient;

  beforeEach(() => {
    controlClient = new ControlToolsHttpClient('test-region', 'https://test.com');
    dataClient = new DataToolsHttpClient('test-region', 'https://test.com');
  });

  it('create code interpreter', async () => {
    const responseData = {
      name: 'test-code-interpreter-name',
      description: 'test-code-interpreter-description',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      execution_agency_name: 'my_agency',
      observability: {},
      network_config: {},
      agent_gateway_id: 'a1b2c3d4-e5f6-7890-abcd-ef12334567890',
      tags: [],
    };
    const postSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'post')
      .mockResolvedValue(okResult(responseData));

    const requestParams = {
      name: 'test-code-interpreter-name',
      description: 'test-code-interpreter-description',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      execution_agency_name: 'my_agency',
      observability: {},
      network_config: {},
      agent_gateway_id: 'a1b2c3d4-e5f6-7890-abcd-ef12334567890',
      tags: [],
    };

    const result = await controlClient.createCodeInterpreter(requestParams);

    expect(result).toEqual(responseData);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/v1/core/code-interpreters', { json: requestParams });
  });

  it('list code interpreters', async () => {
    const responseData = {
      total: 1,
      items: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'string',
          description: 'string',
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          execution_agency_name: 'my_agency',
          agent_gateway_id: '',
          workload_identity: {
            urn: 'agentArts:cn-north-7:123456789:coreCodeInterpreter:123321',
          },
          access_endpoint: '',
          observability: {},
          tags: [],
        },
      ],
    };
    const getSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'get')
      .mockResolvedValue(okResult(responseData));

    const result = await controlClient.listCodeInterpreters({ offset: 0, limit: 10 });

    expect(result).toEqual(responseData);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/v1/core/code-interpreters', { offset: 0, limit: 10 });
  });

  it('update code interpreter', async () => {
    const codeInterpreterId = 'test-code-interpreter-id';
    const responseData = {
      observability: {},
      tags: [{ key: 'test-tag', value: 'test-tag-value' }],
    };
    const putSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'put')
      .mockResolvedValue(okResult(responseData));

    const result = await controlClient.updateCodeInterpreter(codeInterpreterId, {
      observability: {},
      tags: [{ key: 'test-tag', value: 'test-tag-value' }],
    });

    expect(result).toEqual(responseData);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(
      `/v1/core/code-interpreters/${codeInterpreterId}`,
      {
        json: { observability: {}, tags: [{ key: 'test-tag', value: 'test-tag-value' }] },
      },
    );
  });

  it('get code interpreter', async () => {
    const codeInterpreterId = 'test-code-interpreter-id';
    const responseData = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'string',
      description: 'string',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      execution_agency_name: 'my_agency',
      agent_gateway_id: '',
      workload_identity: {
        urn: 'agentArts:cn-north-7:123456789:coreCodeInterpreter:123321',
      },
      access_endpoint: '',
      observability: {},
      tags: [],
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      network_config: {},
    };
    const getSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'get')
      .mockResolvedValue(okResult(responseData));

    const result = await controlClient.getCodeInterpreter(codeInterpreterId);

    expect(result).toEqual(responseData);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(`/v1/core/code-interpreters/${codeInterpreterId}`);
  });

  it('delete code interpreter', async () => {
    const codeInterpreterId = 'test-code-interpreter-id';
    const deleteSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'delete')
      .mockResolvedValue(okResult(null));

    await controlClient.deleteCodeInterpreter(codeInterpreterId);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(`/v1/core/code-interpreters/${codeInterpreterId}`);
  });

  it('start session', async () => {
    const responseData = {
      code_interpreter_id: 'test-code-interpreter-id',
      created_at: '2026-01-01T00:00:00Z',
      name: 'test-session-name',
      session_id: 'test-session-id',
      session_timeout: 600,
    };
    const putSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'put')
      .mockResolvedValue(okResult(responseData));
    const codeInterpreterName = 'test-code-interpreter-name';
    const apiKey = 'test-api-key';
    const requestParams = { name: 'test-session-name', session_timeout: 600 };

    const result = await dataClient.startSession(
      codeInterpreterName,
      requestParams,
      apiKey,
    );

    expect(result).toEqual(responseData);
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(
      `/v1/code-interpreters/${codeInterpreterName}/sessions-start`,
      { json: requestParams, headers: { Authorization: `Bearer ${apiKey}` } },
    );
  });

  it('get session', async () => {
    const responseData = {
      code_interpreter_id: 'test-code-interpreter-id',
      created_at: '2026-01-01T00:00:00Z',
      name: 'test-session-name',
      session_id: 'test-session-id',
      session_timeout: 600,
    };
    const getSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'get')
      .mockResolvedValue(okResult(responseData));
    const codeInterpreterName = 'test-code-interpreter-name';
    const apiKey = 'test-api-key';
    const sessionId = 'test-session-id';

    const result = await dataClient.getSession(codeInterpreterName, sessionId, apiKey);

    expect(result).toEqual(responseData);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      `/v1/code-interpreters/${codeInterpreterName}/sessions-get`,
      undefined,
      {
        headers: {
          'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
  });

  it('stop session', async () => {
    const putSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ session_id: 'test-session-id' }));
    const codeInterpreterName = 'test-code-interpreter-name';
    const apiKey = 'test-api-key';
    const sessionId = 'test-session-id';

    await dataClient.stopSession(codeInterpreterName, sessionId, apiKey);

    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(
      `/v1/code-interpreters/${codeInterpreterName}/sessions-stop`,
      {
        headers: {
          'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
          Authorization: `Bearer ${apiKey}`,
        },
      },
    );
  });

  it('invoke', async () => {
    const responseData = {
      result: {
        content: [
          {
            type: 'string',
            data: '',
            description: 'string',
            mime_type: 'string',
            name: 'string',
            size: 1,
            text: 'string',
            url: 'string',
            resource: {
              type: 'string',
              blob: '',
              mime_type: 'string',
              text: 'string',
              uri: 'string',
            },
          },
        ],
        is_error: false,
        structured_content: {
          execution_time: 100,
          exit_code: 0,
          stderr: 'string',
          stdout: 'string',
        },
      },
    };
    const postSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'post')
      .mockResolvedValue(okResult(responseData));
    const codeInterpreterName = 'test-code-interpreter-name';
    const apiKey = 'test-api-key';
    const sessionId = 'test-session-id';
    const params = {
      operate_type: 'execute_code',
      arguments: {
        clear_context: false,
        code: "print('hello world')",
        language: 'python',
      },
    };

    const result = await dataClient.invoke(codeInterpreterName, sessionId, params, apiKey);

    expect(result).toEqual(responseData);
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      `/v1/code-interpreters/${codeInterpreterName}/invoke`,
      {
        headers: {
          'x-HW-Agentarts-Code-Interpreter-Session-Id': sessionId,
          Authorization: `Bearer ${apiKey}`,
        },
        json: params,
      },
    );
  });
});

describe('TestBrowserHttpClient', () => {
  let controlClient: ControlBrowserHttpClient;
  let dataClient: DataBrowserHttpClient;

  beforeEach(() => {
    controlClient = new ControlBrowserHttpClient('test-region', 'https://test.com');
    dataClient = new DataBrowserHttpClient('test-region', 'https://test.com');
  });

  it('create browser', async () => {
    const postSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'post')
      .mockResolvedValue(okResult({ id: 'browser-1', name: 'test' }));

    const result = await controlClient.createBrowser({
      name: 'test-browser',
      auth_type: 'API_KEY',
    });

    expect(result).toEqual({ id: 'browser-1', name: 'test' });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/v1/core/browsers', {
      json: { name: 'test-browser', auth_type: 'API_KEY' },
    });
  });

  it('list browsers', async () => {
    const getSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'get')
      .mockResolvedValue(okResult({ items: [], total_count: 0 }));

    const result = await controlClient.listBrowsers({});

    expect(result).toEqual({ items: [], total_count: 0 });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/v1/core/browsers', {});
  });

  it('get browser', async () => {
    const getSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'get')
      .mockResolvedValue(okResult({ id: 'browser-1' }));

    const result = await controlClient.getBrowser('browser-1');

    expect(result).toEqual({ id: 'browser-1' });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/v1/core/browsers/browser-1');
  });

  it('delete browser', async () => {
    const deleteSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'delete')
      .mockResolvedValue(okResult(null, 204));

    await controlClient.deleteBrowser('browser-1');

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('/v1/core/browsers/browser-1');
  });

  it('start session', async () => {
    const putSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ session_id: 's-1' }));

    const result = await dataClient.startSession(
      'test-browser',
      { name: 'my-session', session_timeout: 900 },
      's-1',
    );

    expect(result).toEqual({ session_id: 's-1' });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/v1/browsers/test-browser/sessions-start', {
      json: { name: 'my-session', session_timeout: 900 },
      headers: { 'X-hw-Agentarts-Browser-Session-Id': 's-1' },
    });
  });

  it('invoke', async () => {
    const postSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'post')
      .mockResolvedValue(okResult({ result: 'ok' }));

    const result = await dataClient.invoke('test-browser', 's-1', 'navigate', {
      url: 'https://example.com',
    });

    expect(result).toEqual({ result: 'ok' });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/v1/browsers/test-browser/invoke', {
      headers: { 'X-hw-Agentarts-Browser-Session-Id': 's-1' },
      json: { type: 'navigate', action: { url: 'https://example.com' } },
    });
  });

  it('update browser', async () => {
    const putSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ id: 'browser-1' }));

    const result = await controlClient.updateBrowser('browser-1', { name: 'updated' });

    expect(result).toEqual({ id: 'browser-1' });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/v1/core/browsers/browser-1', {
      json: { name: 'updated' },
    });
  });

  it('create browser profile', async () => {
    const postSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'post')
      .mockResolvedValue(okResult({ id: 'p-1' }));

    const result = await controlClient.createBrowserProfile({ name: 'profile-1' });

    expect(result).toEqual({ id: 'p-1' });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith('/v1/core/browser-profiles', {
      json: { name: 'profile-1' },
    });
  });

  it('list browser profiles', async () => {
    const getSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'get')
      .mockResolvedValue(okResult({ items: [], total_count: 0 }));

    const result = await controlClient.listBrowserProfiles({});

    expect(result).toEqual({ items: [], total_count: 0 });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/v1/core/browser-profiles', {});
  });

  it('get browser profile', async () => {
    const getSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'get')
      .mockResolvedValue(okResult({ id: 'p-1' }));

    const result = await controlClient.getBrowserProfile('p-1');

    expect(result).toEqual({ id: 'p-1' });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith('/v1/core/browser-profiles/p-1');
  });

  it('delete browser profile', async () => {
    const deleteSpy = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'delete')
      .mockResolvedValue(okResult(null, 204));

    await controlClient.deleteBrowserProfile('p-1');

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith('/v1/core/browser-profiles/p-1');
  });

  it('stop session', async () => {
    const putSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ session_id: 's-1' }));

    const result = await dataClient.stopSession('test-browser', 's-1');

    expect(result).toEqual({ session_id: 's-1' });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/v1/browsers/test-browser/sessions-stop', {
      headers: { 'X-hw-Agentarts-Browser-Session-Id': 's-1' },
    });
  });

  it('get session', async () => {
    const getSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'get')
      .mockResolvedValue(okResult({ session_id: 's-1' }));

    const result = await dataClient.getSession('test-browser', 's-1');

    expect(result).toEqual({ session_id: 's-1' });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      '/v1/browsers/test-browser/sessions-get',
      undefined,
      { headers: { 'X-hw-Agentarts-Browser-Session-Id': 's-1' } },
    );
  });

  it('update stream', async () => {
    const putSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ ok: true }));

    const result = await dataClient.updateStream('test-browser', 's-1', 'enabled');

    expect(result).toEqual({ ok: true });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/v1/browsers/test-browser/streams-update', {
      headers: { 'X-hw-Agentarts-Browser-Session-Id': 's-1' },
      json: { stream_update: { automation_stream_update: { stream_status: 'enabled' } } },
    });
  });

  it('save profile', async () => {
    const putSpy = vi
      .spyOn(DataBrowserHttpClient.prototype, 'put')
      .mockResolvedValue(okResult({ ok: true }));

    const result = await dataClient.saveProfile('test-browser', 's-1', 'p-1');

    expect(result).toEqual({ ok: true });
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith('/v1/browsers/test-browser/save-profile', {
      headers: {
        'X-hw-Agentarts-Browser-Session-Id': 's-1',
        'X-HW-AgentArts-Browser-Profile-Id': 'p-1',
      },
    });
  });

  it('build ws headers api key', async () => {
    const headers = await dataClient.buildWsHeaders(
      's-1',
      'wss://example.com',
      'test-api-key',
    );

    expect(headers['X-hw-Agentarts-Browser-Session-Id']).toBe('s-1');
    expect(headers['Authorization']).toBe('Bearer test-api-key');
    expect(headers['Upgrade']).toBe('websocket');
    expect(headers['Connection']).toBe('Upgrade');
    expect(headers['Sec-WebSocket-Version']).toBe('13');
    // Python's `base64.b64encode(os.urandom(16))` → 24-char base64 of 16 bytes.
    expect(Buffer.from(headers['Sec-WebSocket-Key'], 'base64')).toHaveLength(16);
  });
});

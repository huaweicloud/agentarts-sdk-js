/**
 * Comprehensive unit tests for the HTTP client module.
 *
 * Ported 1:1 from `tests/unit/sdk/service/test_http_client.py`.
 *
 * Python patches `requests.Session.request`; the Node.js port uses the global
 * `fetch`, so every request-level test stubs `fetch` with a real `Response`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  BaseHTTPClient,
  RequestConfig,
  RequestResult,
} from 'agentarts-sdk/sdk/service/http-client';
import { SDKSigner } from 'agentarts-sdk/sdk/utils/signer';

type FetchMock = ReturnType<typeof vi.fn>;

/** Replace the global `fetch` with a mock returning `response`. */
function stubFetch(response: Response): FetchMock {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock as unknown as FetchMock;
}

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function textResponse(
  text: string,
  status = 200,
  headers: Record<string, string> = { 'Content-Type': 'text/plain' },
): Response {
  return new Response(text, { status, headers });
}

/** A fake raw response carrying an exactly-controlled body stream. */
function streamRawResponse(chunks: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return { body: stream } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// RequestConfig Tests
// ============================================================

describe('TestRequestConfig', () => {
  it('default values', () => {
    const config = new RequestConfig();
    expect(config.baseUrl).toBe('');
    expect(config.timeout).toBe(30.0);
    expect(config.headers).toEqual({});
    expect(config.verifySsl).toBe(true);
  });

  it('custom base url', () => {
    const config = new RequestConfig({ baseUrl: 'https://api.example.com' });
    expect(config.baseUrl).toBe('https://api.example.com');
  });

  it('custom timeout', () => {
    const config = new RequestConfig({ timeout: 60.0 });
    expect(config.timeout).toBe(60.0);
  });

  it('custom headers', () => {
    const config = new RequestConfig({
      headers: { 'X-Custom': 'value', Authorization: 'Bearer token' },
    });
    expect(config.headers['X-Custom']).toBe('value');
    expect(config.headers['Authorization']).toBe('Bearer token');
  });

  it('verify ssl false', () => {
    const config = new RequestConfig({ verifySsl: false });
    expect(config.verifySsl).toBe(false);
  });

  it('full custom config', () => {
    const config = new RequestConfig({
      baseUrl: 'https://api.example.com',
      timeout: 120.0,
      headers: { 'Content-Type': 'application/json' },
      verifySsl: false,
    });
    expect(config.baseUrl).toBe('https://api.example.com');
    expect(config.timeout).toBe(120.0);
    expect(config.headers['Content-Type']).toBe('application/json');
    expect(config.verifySsl).toBe(false);
  });
});

// ============================================================
// RequestResult Tests
// ============================================================

describe('TestRequestResult', () => {
  it('success result with json data', () => {
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      data: { id: 1, name: 'test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual({ id: 1, name: 'test' });
    expect(result.error).toBeNull();
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('success result with text data', () => {
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      data: 'plain text response',
    });
    expect(result.success).toBe(true);
    expect(result.data).toBe('plain text response');
  });

  it('success result with none data', () => {
    const result = new RequestResult({ success: true, statusCode: 204 });
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
    expect(result.error).toBeNull();
    expect(result.headers).toEqual({});
  });

  it('error result', () => {
    const result = new RequestResult({
      success: false,
      statusCode: 500,
      error: 'Internal Server Error',
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.error).toBe('Internal Server Error');
  });

  it('timeout error result', () => {
    const result = new RequestResult({
      success: false,
      statusCode: 0,
      error: 'Request timeout: 30s',
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
  });

  it('connection error result', () => {
    const result = new RequestResult({
      success: false,
      statusCode: 0,
      error: 'Request error: Connection refused',
    });
    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
  });
});

// ============================================================
// BaseHTTPClient Initialization Tests
// ============================================================

describe('TestBaseHTTPClientInit', () => {
  it('init default config', () => {
    const client = new BaseHTTPClient();
    expect(client['_config'].baseUrl).toBe('');
    expect(client['_config'].timeout).toBe(30.0);
    expect(client['_config'].verifySsl).toBe(true);
    // Python asserts a `requests.Session` exists; the Node.js port is stateless
    // and keeps the session-equivalent default headers instead.
    expect(client['_defaultHeaders']['User-Agent']).toContain('agentarts-sdk-nodejs/');
  });

  it('init with request config', () => {
    const config = new RequestConfig({ baseUrl: 'https://api.example.com', timeout: 60.0 });
    const client = new BaseHTTPClient(config);
    expect(client['_config'].baseUrl).toBe('https://api.example.com');
    expect(client['_config'].timeout).toBe(60.0);
  });

  it('init headers applied to session', () => {
    const config = new RequestConfig({ headers: { 'X-API-Key': 'abc123' } });
    const client = new BaseHTTPClient(config);
    expect(client['_defaultHeaders']['X-API-Key']).toBe('abc123');
  });
});

// ============================================================
// BaseHTTPClient Header & Auth Tests
// ============================================================

describe('TestBaseHTTPClientHeaders', () => {
  it('set header', () => {
    const mock = stubFetch(jsonResponse({}, 200, {}));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    client.setHeader('X-Custom', 'value');
    expect(client['_config'].headers['X-Custom']).toBe('value');
    expect(client['_defaultHeaders']['X-Custom']).toBe('value');
    expect(mock).not.toHaveBeenCalled();
  });

  it('set header overwrite', () => {
    const client = new BaseHTTPClient();
    client.setHeader('X-Custom', 'value1');
    client.setHeader('X-Custom', 'value2');
    expect(client['_config'].headers['X-Custom']).toBe('value2');
  });

  it('set multiple headers', () => {
    const client = new BaseHTTPClient();
    client.setHeader('X-Key-1', 'val1');
    client.setHeader('X-Key-2', 'val2');
    expect(Object.keys(client['_config'].headers).length).toBe(2);
  });

  it('set auth token bearer', () => {
    const client = new BaseHTTPClient();
    client.setAuthToken('my-token');
    expect(client['_config'].headers['Authorization']).toBe('Bearer my-token');
    expect(client['_defaultHeaders']['Authorization']).toBe('Bearer my-token');
  });

  it('set auth token custom scheme', () => {
    const client = new BaseHTTPClient();
    client.setAuthToken('my-token', 'Basic');
    expect(client['_config'].headers['Authorization']).toBe('Basic my-token');
  });

  it('set auth token overwrite', () => {
    const client = new BaseHTTPClient();
    client.setAuthToken('token1');
    client.setAuthToken('token2');
    expect(client['_config'].headers['Authorization']).toBe('Bearer token2');
  });

  it('clear auth', () => {
    const client = new BaseHTTPClient();
    client.setAuthToken('my-token');
    client.clearAuth();
    expect('Authorization' in client['_config'].headers).toBe(false);
    expect('Authorization' in client['_defaultHeaders']).toBe(false);
  });

  it('clear auth when not set', () => {
    const client = new BaseHTTPClient();
    client.clearAuth();
    expect('Authorization' in client['_config'].headers).toBe(false);
  });
});

// ============================================================
// BaseHTTPClient Request Method Tests
// ============================================================

describe('TestBaseHTTPClientRequests', () => {
  it('get request success', async () => {
    const mock = stubFetch(jsonResponse({ id: 1 }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/users/1');

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.data).toEqual({ id: 1 });
    expect(mock).toHaveBeenCalledTimes(1);
    const [url, init] = mock.mock.calls[0] as [string, any];
    expect(url).toBe('https://api.example.com/users/1');
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('get request with params', async () => {
    const mock = stubFetch(jsonResponse([]));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    const requestSpy = vi.spyOn(client as any, '_request');

    const result = await client.get('/users', { page: 1, size: 10 });

    expect(result.success).toBe(true);
    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect((requestSpy.mock.calls[0][2] as any).params).toEqual({ page: 1, size: 10 });
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('post request json', async () => {
    const mock = stubFetch(jsonResponse({ created: true }, 201));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.post('/users', { json: { name: 'test' } });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(201);
    expect(result.data).toEqual({ created: true });
    const init = mock.mock.calls[0][1] as any;
    expect(JSON.parse(init.body)).toEqual({ name: 'test' });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('post request form data', async () => {
    const mock = stubFetch(jsonResponse({ ok: true }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.post('/form', { data: { key: 'value' } });

    expect(result.success).toBe(true);
    const init = mock.mock.calls[0][1] as any;
    expect(init.body).toBe('key=value');
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('put request', async () => {
    const mock = stubFetch(jsonResponse({ updated: true }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.put('/users/1', { json: { name: 'updated' } });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ updated: true });
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0][1] as any).method).toBe('PUT');
  });

  it('patch request', async () => {
    const mock = stubFetch(jsonResponse({ patched: true }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.patch('/users/1', { json: { name: 'patched' } });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ patched: true });
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0][1] as any).method).toBe('PATCH');
  });

  it('delete request', async () => {
    const mock = stubFetch(new Response(null, { status: 204 }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.delete('/users/1');

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(204);
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0][1] as any).method).toBe('DELETE');
  });

  it('custom method request', async () => {
    const mock = stubFetch(jsonResponse({ ok: true }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.request('HEAD', '/resource');

    expect(result.success).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    expect((mock.mock.calls[0][1] as any).method).toBe('HEAD');
  });
});

// ============================================================
// BaseHTTPClient Response Parsing Tests
// ============================================================

describe('TestBaseHTTPClientResponseParsing', () => {
  it('json response parsed', async () => {
    stubFetch(jsonResponse({ message: 'hello' }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/test');

    expect(typeof result.data).toBe('object');
    expect(result.data['message']).toBe('hello');
  });

  it('text response fallback', async () => {
    stubFetch(textResponse('plain text'));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/test');

    expect(result.data).toBe('plain text');
  });

  it('empty response', async () => {
    stubFetch(new Response(null, { status: 204 }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/test');

    expect(result.data).toBeNull();
  });

  it('4xx response marked as failure', async () => {
    stubFetch(jsonResponse({ error: 'Not found' }, 404, {}));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/not-found');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(404);
    expect(result.data).toEqual({ error: 'Not found' });
  });

  it('5xx response marked as failure', async () => {
    stubFetch(jsonResponse({ error: 'Internal error' }, 500, {}));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/error');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
  });

  it('response headers captured', async () => {
    stubFetch(
      jsonResponse({}, 200, { 'Content-Type': 'application/json', 'X-Request-Id': 'abc' }),
    );
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await client.get('/test');

    // `fetch` normalizes response header names to lower case.
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.headers['x-request-id']).toBe('abc');
  });
});

// ============================================================
// BaseHTTPClient Error Handling Tests
// ============================================================

describe('TestBaseHTTPClientErrors', () => {
  it('timeout error', async () => {
    const timeoutError = Object.assign(new Error('Connection timed out'), { name: 'TimeoutError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw timeoutError;
      }),
    );

    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    const result = await client.get('/slow');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error!.toLowerCase()).toContain('timeout');
  });

  it('connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Connection refused');
      }),
    );

    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    const result = await client.get('/unreachable');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error!.toLowerCase()).toContain('error');
  });

  it('generic request exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Something went wrong');
      }),
    );

    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    const result = await client.get('/fail');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error!.toLowerCase()).toContain('error');
  });

  it('unexpected exception', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Unexpected');
      }),
    );

    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    const result = await client.get('/unexpected');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error!.toLowerCase()).toContain('unexpected');
  });
});

// ============================================================
// BaseHTTPClient Config Propagation Tests
// ============================================================

describe('TestBaseHTTPClientConfigPropagation', () => {
  it('base url prepended', async () => {
    const mock = stubFetch(jsonResponse({}));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    await client.get('/users');

    expect(mock.mock.calls[0][0]).toBe('https://api.example.com/users');
  });

  it('timeout passed to request', async () => {
    stubFetch(jsonResponse({}));
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const client = new BaseHTTPClient(
      new RequestConfig({ baseUrl: 'https://api.example.com', timeout: 99.0 }),
    );

    await client.get('/test');

    expect(timeoutSpy).toHaveBeenCalledWith(99_000);
  });

  it('verify ssl disabled', async () => {
    const mock = stubFetch(jsonResponse({}));
    const client = new BaseHTTPClient(
      new RequestConfig({ baseUrl: 'https://api.example.com', verifySsl: false }),
    );

    await client.get('/test');

    // The Python client forwards `verify=False` to requests; the Node.js port
    // builds a custom undici Agent (rejectUnauthorized: false) as dispatcher.
    const init = mock.mock.calls[0][1] as any;
    expect(init.dispatcher).toBeDefined();
    expect((client as any)._getDispatcher()).toBeDefined();
    expect((new BaseHTTPClient() as any)._getDispatcher()).toBeUndefined();
  });

  it('auth header sent with request', async () => {
    const mock = stubFetch(jsonResponse({}));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));
    client.setAuthToken('secret-token');

    await client.get('/protected');

    expect(client['_defaultHeaders']['Authorization']).toBe('Bearer secret-token');
    const init = mock.mock.calls[0][1] as any;
    expect(init.headers['Authorization']).toBe('Bearer secret-token');
  });
});

// ============================================================
// BaseHTTPClient Lifecycle Tests
// ============================================================

describe('TestBaseHTTPClientLifecycle', () => {
  it('close', () => {
    const client = new BaseHTTPClient();
    (client as any)._dispatcher = { fake: true };

    client.close();

    expect((client as any)._dispatcher).toBeUndefined();
  });

  it('close idempotent', () => {
    const client = new BaseHTTPClient();
    client.close();
    client.close();
    expect((client as any)._dispatcher).toBeUndefined();
  });
});

// ============================================================
// RequestResult Streaming Tests
// ============================================================

describe('TestRequestResultStreaming', () => {
  it('streaming flag default false', () => {
    const result = new RequestResult({ success: true, statusCode: 200 });
    expect(result.streaming).toBe(false);
  });

  it('streaming flag explicit true', () => {
    const result = new RequestResult({ success: true, statusCode: 200, streaming: true });
    expect(result.streaming).toBe(true);
  });

  it('iter lines raises on non streaming', async () => {
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      data: { key: 'val' },
    });

    const collect = async (): Promise<string[]> => {
      const lines: string[] = [];
      for await (const line of result.iterLines()) {
        lines.push(line);
      }
      return lines;
    };

    await expect(collect()).rejects.toThrow(/iterLines/);
  });

  it('iter bytes raises on non streaming', async () => {
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      data: { key: 'val' },
    });

    const collect = async (): Promise<Uint8Array[]> => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of result.iterBytes()) {
        chunks.push(chunk);
      }
      return chunks;
    };

    await expect(collect()).rejects.toThrow(/iterBytes/);
  });

  it('iter lines yields lines', async () => {
    const rawResponse = new Response('event: start\ndata: hello\n\ndata: world');
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      streaming: true,
      rawResponse,
    });

    const lines: string[] = [];
    for await (const line of result.iterLines()) {
      lines.push(line);
    }

    expect(lines).toEqual(['event: start', 'data: hello', '', 'data: world']);
  });

  it('iter bytes yields chunks', async () => {
    const rawResponse = streamRawResponse([
      new TextEncoder().encode('chunk1'),
      new TextEncoder().encode('chunk2'),
      new TextEncoder().encode('chunk3'),
    ]);
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      streaming: true,
      rawResponse,
    });

    const chunks: string[] = [];
    for await (const chunk of result.iterBytes()) {
      chunks.push(new TextDecoder().decode(chunk));
    }

    expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
  });

  it('iter bytes skips empty chunks', async () => {
    const rawResponse = streamRawResponse([
      new TextEncoder().encode('data'),
      new Uint8Array(0),
      new TextEncoder().encode('more'),
    ]);
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      streaming: true,
      rawResponse,
    });

    const chunks: string[] = [];
    for await (const chunk of result.iterBytes()) {
      chunks.push(new TextDecoder().decode(chunk));
    }

    expect(chunks).toEqual(['data', 'more']);
  });

  it('close closes raw response', () => {
    const cancel = vi.fn(async () => undefined);
    const rawResponse = { body: { cancel } } as unknown as Response;
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      streaming: true,
      rawResponse,
    });

    result.close();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect((result as any)._rawResponse).toBeUndefined();
  });

  it('close idempotent', () => {
    const cancel = vi.fn(async () => undefined);
    const rawResponse = { body: { cancel } } as unknown as Response;
    const result = new RequestResult({
      success: true,
      statusCode: 200,
      streaming: true,
      rawResponse,
    });

    result.close();
    result.close();

    expect((result as any)._rawResponse).toBeUndefined();
  });

  it('close on non streaming no error', () => {
    const result = new RequestResult({ success: true, statusCode: 200 });
    expect(() => result.close()).not.toThrow();
  });

  it('streaming result data is none', () => {
    const result = new RequestResult({ success: true, statusCode: 200, streaming: true });
    expect(result.data).toBeNull();
  });
});

// ============================================================
// BaseHTTPClient Inheritance Tests
// ============================================================

class MyAPIClient extends BaseHTTPClient {
  constructor() {
    super(new RequestConfig({ baseUrl: 'https://api.example.com' }));
  }

  getUser(userId: string): Promise<RequestResult> {
    return this.get(`/users/${userId}`);
  }
}

describe('TestBaseHTTPClientInheritance', () => {
  it('subclass basic usage', () => {
    const client = new MyAPIClient();
    expect(client['_config'].baseUrl).toBe('https://api.example.com');
    expect(typeof client.getUser).toBe('function');
  });

  it('subclass method calls base', async () => {
    const mock = stubFetch(jsonResponse({ id: '123', name: 'test' }, 200, {}));
    const client = new MyAPIClient();

    const result = await client.getUser('123');

    expect(result.success).toBe(true);
    expect(result.data['id']).toBe('123');
    expect(mock.mock.calls[0][0]).toBe('https://api.example.com/users/123');
    expect((mock.mock.calls[0][1] as any).method).toBe('GET');
  });
});

// ============================================================
// BaseHTTPClient Streaming Request Tests
// ============================================================

describe('TestBaseHTTPClientStreaming', () => {
  it('stream always passed to requests', async () => {
    // Python always forwards `stream=True` to requests. The Node.js port sends
    // no `stream` option to fetch; streaming is derived from Content-Type.
    const mock = stubFetch(
      new Response('data: x\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/test');

    const init = mock.mock.calls[0][1] as any;
    expect(init).not.toHaveProperty('stream');
    expect(result.streaming).toBe(true);
  });

  it('sse content type returns streaming result', async () => {
    const response = new Response('data: x\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
    });
    stubFetch(response);
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/events');

    expect(result.success).toBe(true);
    expect(result.streaming).toBe(true);
    expect(result.data).toBeNull();
    expect((result as any)._rawResponse).toBe(response);
    expect(result.headers['content-type']).toBe('text/event-stream; charset=utf-8');
  });

  it('ndjson content type returns streaming result', async () => {
    stubFetch(
      new Response('{"a":1}\n', {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      }),
    );
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/stream');

    expect(result.streaming).toBe(true);
    expect(result.data).toBeNull();
  });

  it('json content type returns regular result', async () => {
    stubFetch(jsonResponse({ message: 'hello' }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/api');

    expect(result.success).toBe(true);
    expect(result.streaming).toBe(false);
    expect(result.data).toEqual({ message: 'hello' });
  });

  it('text plain content type returns regular result', async () => {
    stubFetch(textResponse('plain text'));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/text');

    expect(result.streaming).toBe(false);
    expect(result.data).toBe('plain text');
  });

  it('no content type returns regular result', async () => {
    stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/test');

    expect(result.streaming).toBe(false);
    expect(result.data).toEqual({ ok: true });
  });

  it('streaming result error still returned', async () => {
    stubFetch(
      new Response(null, { status: 500, headers: { 'Content-Type': 'text/event-stream' } }),
    );
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/events');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    expect(result.streaming).toBe(true);
  });

  it('regular response closed after parsing', async () => {
    // Python closes the streaming session response after consuming the body;
    // the Node.js port consumes (and therefore releases) `response.body`.
    const response = jsonResponse({ ok: true });
    stubFetch(response);
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/test');

    expect(result.streaming).toBe(false);
    expect(response.bodyUsed).toBe(true);
  });

  it('connection error returns non streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Connection refused');
      }),
    );
    const client = new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://api.example.com' }));

    const result = await (client as any)._request('GET', '/events');

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.streaming).toBe(false);
  });
});

// ============================================================
// SDK signature: binary bodies
// ============================================================

describe('TestSdkSignatureBinaryBody', () => {
  function signedClient(): BaseHTTPClient {
    vi.stubEnv('HUAWEICLOUD_SDK_AK', 'fake-ak');
    vi.stubEnv('HUAWEICLOUD_SDK_SK', 'fake-sk');
    vi.stubEnv('HUAWEICLOUD_SDK_PROJECT_ID', 'fake-project');
    return new BaseHTTPClient(new RequestConfig({ baseUrl: 'https://control.example.com' }), true);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('signs Uint8Array bodies as UNSIGNED-PAYLOAD', async () => {
    const client = signedClient();
    const mock = stubFetch(jsonResponse({ ok: true }));
    const signSpy = vi.spyOn(SDKSigner.prototype, 'sign');
    const payload = new Uint8Array([1, 2, 3, 4]);

    await (client as any)._request('POST', '/v1/core/upload', { data: payload });

    // The binary payload must not be stringified into a form body for signing.
    expect(signSpy.mock.calls[0][3]).toBeNull();

    const init = mock.mock.calls[0][1] as RequestInit;
    // The signer normalizes the header name; assert what actually hits the wire.
    expect((init.headers as Record<string, string>)['X-Sdk-Content-Sha256']).toBe(
      'UNSIGNED-PAYLOAD',
    );
    expect(init.body).toBe(payload);
  });

  it('signs FormData bodies as UNSIGNED-PAYLOAD without form-encoding them', async () => {
    const client = signedClient();
    const mock = stubFetch(jsonResponse({ ok: true }));
    const signSpy = vi.spyOn(SDKSigner.prototype, 'sign');
    const form = new FormData();
    form.append('file', new Blob(['hello']), 'a.txt');

    await (client as any)._request('POST', '/v1/core/upload', { data: form });

    expect(signSpy.mock.calls[0][3]).toBeNull();

    const init = mock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-Sdk-Content-Sha256']).toBe(
      'UNSIGNED-PAYLOAD',
    );
    expect(init.body).toBe(form);
    // fetch sets the multipart boundary itself; a stale JSON/form type breaks it.
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
  });
});

/**
 * Unit tests for MemoryHttpService / AsyncMemoryHttpService exception semantics.
 *
 * Ported 1:1 from `tests/unit/sdk/service/test_memory_service_exceptions.py`,
 * which covers the service-layer exception fixes (service-exception-fix-plan.md
 * Part A):
 * - Network errors (timeout / connection refused) -> MemoryAPIException(statusCode=0,
 *   NETWORK_ERROR) with the original error chained via `cause` (`__cause__` in Python)
 * - Real HTTP errors (503 / 404) keep their actual status code
 * - 2xx success unchanged
 * - 2xx with an invalid JSON body -> MemoryAPIException(statusCode=<actual>, PARSE_ERROR)
 * - isNetworkError / retryable properties
 *
 * Porting notes: Python mocks `requests.Session.request` / `httpx`; here the
 * transport is the global `fetch`, so a real `Response` is injected with
 * `vi.stubGlobal('fetch', vi.fn())`. The async service patches `_get_client`; the
 * Node.js port spies on the equivalent `_getClient()`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { APIException, MemoryAPIException } from 'agentarts-sdk/sdk/service/http-client';
import {
  ControlPlaneAuthenticationStrategy,
  MemoryHttpService,
  sendHttpRequest,
} from 'agentarts-sdk/sdk/service/memory-service';
import { SDKSigner } from 'agentarts-sdk/sdk/utils/signer';
import { AsyncMemoryHttpService } from 'agentarts-sdk/sdk/service/memory-service-async';

/** Create a data-plane `MemoryHttpService` (no AK/SK signing needed). */
function syncService(): MemoryHttpService {
  return new MemoryHttpService({
    regionName: 'cn-north-4',
    endpointType: 'data',
    apiKey: 'test-api-key',
    verifySsl: false,
  });
}

/** Create a data-plane `AsyncMemoryHttpService`. */
function asyncService(): AsyncMemoryHttpService {
  return new AsyncMemoryHttpService({
    regionName: 'cn-north-4',
    endpointType: 'data',
    apiKey: 'test-api-key',
    verifySsl: false,
  });
}

/** `requests`-like JSON response: case-insensitive headers via real `Response`. */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** `requests`-like text response announced as JSON (invalid JSON body). */
function invalidJsonResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Await a rejecting call and return the thrown value. */
async function captureRejection(promise: Promise<unknown>): Promise<MemoryAPIException> {
  try {
    await promise;
  } catch (error) {
    return error as MemoryAPIException;
  }
  throw new Error('Expected the operation to reject with a MemoryAPIException');
}

beforeEach(() => {
  // Unit tests must never reach the cloud: each test installs its own stub.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('unexpected network call in unit test');
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ============================================================
// Sync MemoryHttpService exception wrapping
// ============================================================

describe('TestSyncExceptionSemantics', () => {
  it('test_network_timeout', async () => {
    // Timeout -> MemoryAPIException(status_code=0, NETWORK_ERROR), cause preserved.
    const timeoutError = Object.assign(new Error('read timeout'), { name: 'TimeoutError' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw timeoutError;
      }),
    );
    const service = syncService();

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc).toBeInstanceOf(MemoryAPIException);
    expect(exc.statusCode).toBe(0);
    expect(exc.errorCode).toBe('NETWORK_ERROR');
    expect(exc.isNetworkError).toBe(true);
    expect(exc.retryable).toBe(true);
    // Python: `isinstance(exc.__cause__, Timeout)`.
    expect(exc.cause).toBe(timeoutError);
  });

  it('test_connection_error', async () => {
    // ConnectionError -> MemoryAPIException(status_code=0, NETWORK_ERROR).
    const connectionError = new TypeError('conn refused');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw connectionError;
      }),
    );
    const service = syncService();

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(0);
    expect(exc.errorCode).toBe('NETWORK_ERROR');
    expect(exc.isNetworkError).toBe(true);
    expect(exc.retryable).toBe(true);
    expect(exc.cause).toBe(connectionError);
  });

  it('test_real_503_keeps_status_code', async () => {
    // Real 503 -> status_code=503, error_code from the backend body, not network.
    const mockResponse = jsonResponse(
      { error_code: 'INTERNAL_ERROR', error_msg: 'server busy' },
      503,
    );
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse));
    const service = syncService();

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(503);
    expect(exc.errorCode).toBe('INTERNAL_ERROR');
    expect(exc.isNetworkError).toBe(false);
    // 503 is retryable.
    expect(exc.retryable).toBe(true);
  });

  it('test_real_404_keeps_status_code', async () => {
    // Real 404 -> status_code=404, not misclassified as a network error.
    const mockResponse = jsonResponse(
      { error_code: 'NOT_FOUND', error_msg: 'Session not found' },
      404,
    );
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse));
    const service = syncService();

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(404);
    expect(exc.errorCode).toBe('NOT_FOUND');
    expect(exc.isNetworkError).toBe(false);
    // 404 not retryable.
    expect(exc.retryable).toBe(false);
  });

  it('test_2xx_success_unchanged', async () => {
    // 2xx JSON response still returns the parsed object.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: true })));
    const service = syncService();

    const result = await service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' });

    expect(result).toEqual({ ok: true });
  });

  it('test_2xx_invalid_json_parse_error', async () => {
    // 2xx + Content-Type json + invalid body -> PARSE_ERROR with the actual status.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => invalidJsonResponse('<html>gateway error</html>', 200)),
    );
    const service = syncService();

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(200);
    expect(exc.errorCode).toBe('PARSE_ERROR');
    expect(exc.isNetworkError).toBe(false);
    // Parse error: no point retrying.
    expect(exc.retryable).toBe(false);
  });

  it('test_204_no_content', async () => {
    // 204 -> empty object, no exception.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const service = syncService();

    const result = await service._makeRequest('DELETE', '/v1/core/spaces/x', { spaceId: 's1' });

    expect(result).toEqual({});
  });
});

// ============================================================
// Async AsyncMemoryHttpService exception wrapping
// ============================================================

describe('TestAsyncExceptionSemantics', () => {
  it('test_async_network_timeout', async () => {
    // Async timeout -> MemoryAPIException(status_code=0, NETWORK_ERROR).
    const service = asyncService();
    const timeoutError = Object.assign(new Error('async read timeout'), { name: 'TimeoutError' });

    // Python patches `_get_client` with a fake client whose request() raises.
    vi.spyOn(service, '_getClient').mockResolvedValue({
      request: vi.fn(async () => {
        throw timeoutError;
      }),
    } as any);

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(0);
    expect(exc.errorCode).toBe('NETWORK_ERROR');
    expect(exc.isNetworkError).toBe(true);
    expect(exc.retryable).toBe(true);
    // Python: `isinstance(exc.__cause__, httpx.TimeoutException)`.
    expect(exc.cause).toBe(timeoutError);
  });

  it('test_async_real_503', async () => {
    // Async real 503 keeps the status code, not a network error.
    const service = asyncService();

    vi.spyOn(service, '_getClient').mockResolvedValue({
      request: vi.fn(
        async () => jsonResponse({ error_code: 'INTERNAL_ERROR', error_msg: 'server busy' }, 503),
      ),
    } as any);

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(503);
    expect(exc.errorCode).toBe('INTERNAL_ERROR');
    expect(exc.isNetworkError).toBe(false);
    expect(exc.retryable).toBe(true);
  });

  it('test_async_2xx_invalid_json_parse_error', async () => {
    // Async 2xx + invalid JSON -> PARSE_ERROR.
    const service = asyncService();

    vi.spyOn(service, '_getClient').mockResolvedValue({
      request: vi.fn(async () => invalidJsonResponse('<html>bad</html>', 200)),
    } as any);

    const exc = await captureRejection(
      service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' }),
    );

    expect(exc.statusCode).toBe(200);
    expect(exc.errorCode).toBe('PARSE_ERROR');
    expect(exc.isNetworkError).toBe(false);
  });

  it('test_async_2xx_success', async () => {
    // Async 2xx success unchanged.
    const service = asyncService();

    vi.spyOn(service, '_getClient').mockResolvedValue({
      request: vi.fn(async () => jsonResponse({ ok: true })),
    } as any);

    const result = await service._makeRequest('GET', '/v1/core/spaces', { spaceId: 's1' });

    expect(result).toEqual({ ok: true });
  });
});

// ============================================================
// MemoryAPIException property semantics
// ============================================================

describe('TestMemoryAPIExceptionProperties', () => {
  it('test_network_error_property', () => {
    const exc = new MemoryAPIException(0, 'NETWORK_ERROR', 'timeout');
    expect(exc.isNetworkError).toBe(true);
    expect(exc.retryable).toBe(true);
  });

  it('test_429_retryable', () => {
    const exc = new MemoryAPIException(429, 'RATE_LIMITED', 'rate limited');
    expect(exc.isNetworkError).toBe(false);
    expect(exc.retryable).toBe(true);
  });

  it('test_500_retryable', () => {
    const exc = new MemoryAPIException(500, 'INTERNAL_ERROR', 'internal');
    expect(exc.retryable).toBe(true);
  });

  it('test_400_not_retryable', () => {
    const exc = new MemoryAPIException(400, 'BAD_REQUEST', 'bad request');
    expect(exc.isNetworkError).toBe(false);
    expect(exc.retryable).toBe(false);
  });

  it('test_is_subclass_of_api_exception', () => {
    // MemoryAPIException must remain a subclass of APIException (backward compat).
    const exc = new MemoryAPIException(0, 'NETWORK_ERROR', 'x');
    expect(exc).toBeInstanceOf(APIException);
  });

  it('test_str_contains_details', () => {
    const exc = new MemoryAPIException(404, 'NOT_FOUND', 'Session not found');
    expect(String(exc)).toContain('404');
    expect(String(exc)).toContain('Session not found');
  });
});

// ============================================================
// Query serialization
// ============================================================

describe('TestMemoryQueryEncoding', () => {
  it('test_wire_query_uses_rfc3986', async () => {
    // The AK/SK canonical query uses RFC 3986, so the wire must not emit the
    // form-style `+` for spaces nor keep `~` escaped (`%7E`).
    const mock = vi.fn(async (_url: string | URL) => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', mock);

    await sendHttpRequest('GET', 'https://memory.example.com/v1/core/spaces', {
      params: {
        actor_id: 'user one(测试)~x',
        limit: 10,
        deleted: null,
        missing: undefined,
      },
    });

    const raw = String(mock.mock.calls[0][0]);
    expect(raw).toContain('actor_id=user%20one%28%E6%B5%8B%E8%AF%95%29~x');
    expect(raw).not.toContain('+');
    expect(raw).not.toContain('deleted=');
    expect(raw).not.toContain('missing=');
    expect(raw).toContain('limit=10');
  });

  it('test_signed_query_matches_wire', async () => {
    // The signer keeps null/undefined verbatim (`deleted=null`), which the wire
    // never carries, so the canonical query must be normalized first.
    const signSpy = vi.spyOn(SDKSigner.prototype, 'sign').mockResolvedValue({});
    try {
      const strategy = new ControlPlaneAuthenticationStrategy();
      (strategy as any)._signer = new SDKSigner();
      const params = {
        deleted: null,
        missing: undefined,
        tag: ['prod', 'dev'],
        limit: 1,
      };

      await strategy.signRequest('GET', 'https://memory.example.com/v1/core/spaces', {}, null, params);

      const signedQuery = signSpy.mock.calls[0][4] as Array<[string, any]>;
      expect(Object.fromEntries(signedQuery)).toEqual({ tag: ['dev', 'prod'], limit: '1' });
      // The caller's array must not be sorted in place by the signer.
      expect(params.tag).toEqual(['prod', 'dev']);
    } finally {
      signSpy.mockRestore();
    }
  });
});

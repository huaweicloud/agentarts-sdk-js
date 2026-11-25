import { expect, it, vi } from 'vitest';
import {
  authenticateProtocol,
  ProtocolHttpError,
  type ProtocolRequest,
} from 'agentarts-sdk/sdk/runtime';
function request(signal: AbortSignal): ProtocolRequest {
  return { method: 'POST', path: '/test', headers: {}, signal, json: async () => ({}) };
}

it('authentication timeout is bounded, sanitized and aborts the provider', async () => {
  vi.useFakeTimers();
  const signal = new AbortController();
  let providerSignal!: AbortSignal;
  const pending = authenticateProtocol(
    request(signal.signal),
    (context) => {
      providerSignal = context.signal;
      return new Promise(() => {});
    },
    20,
  );
  const outcome = Promise.allSettled([pending]);
  await vi.advanceTimersByTimeAsync(20);
  try {
    expect(providerSignal.aborted).toBe(true);
    expect((await outcome)[0]).toMatchObject({
      status: 'rejected',
      reason: { status: 401, code: 'UNAUTHENTICATED' },
    });
  } finally {
    vi.useRealTimers();
  }
});
it('client abort stops authentication without trusting an eventual identity', async () => {
  const signal = new AbortController();
  const pending = authenticateProtocol(request(signal.signal), () => new Promise(() => {}));
  const outcome = Promise.allSettled([pending]);
  signal.abort();
  expect((await outcome)[0]).toMatchObject({ status: 'rejected', reason: { status: 408 } });
});
it('invalid identities and secret-bearing provider errors are rejected without reflection', async () => {
  const signal = new AbortController();
  await expect(
    authenticateProtocol(request(signal.signal), () => ({ tenantId: '', subject: 'user' })),
  ).rejects.toMatchObject({ status: 401, message: 'Authentication failed' });
  await expect(
    authenticateProtocol(request(signal.signal), () => {
      throw new Error('SECRET-KEY');
    }),
  ).rejects.toMatchObject({ status: 401, message: 'Authentication failed' });
});

it.each([400, 401, 403, 408, 429, 500])(
  'sanitizes provider ProtocolHttpError with status %s',
  async (status) => {
    const signal = new AbortController();
    const providerError = new ProtocolHttpError(status, 'PRIVATE-CODE', 'PRIVATE-MESSAGE', {
      'set-cookie': 'PRIVATE-COOKIE',
    });
    for (const provider of [
      () => {
        throw providerError;
      },
      async () => {
        throw providerError;
      },
    ]) {
      const result = await Promise.allSettled([
        authenticateProtocol(request(signal.signal), provider),
      ]);
      expect(result[0]).toMatchObject({
        status: 'rejected',
        reason: {
          status: 401,
          code: 'UNAUTHENTICATED',
          message: 'Authentication failed',
          headers: {},
        },
      });
    }
  },
);

it('sanitizes exceptions from provider-owned identity accessors', async () => {
  const signal = new AbortController();
  await expect(
    authenticateProtocol(request(signal.signal), () => ({
      get tenantId(): string {
        throw new ProtocolHttpError(500, 'PRIVATE-CODE', 'PRIVATE-MESSAGE');
      },
      subject: 'user',
    })),
  ).rejects.toMatchObject({
    status: 401,
    code: 'UNAUTHENTICATED',
    message: 'Authentication failed',
    headers: {},
  });
});

it('keeps timed-out provider operations in the in-flight budget until they actually finish', async () => {
  vi.useFakeTimers();
  const signal = new AbortController();
  const resolvers: Array<(value: null) => void> = [];
  const provider = () =>
    new Promise<null>((resolve) => {
      resolvers.push(resolve);
    });
  const calls = Array.from({ length: 64 }, () =>
    authenticateProtocol(request(signal.signal), provider, 10),
  );
  const outcomes = Promise.allSettled(calls);
  try {
    await vi.advanceTimersByTimeAsync(10);
    await outcomes;
    await expect(authenticateProtocol(request(signal.signal), provider, 10)).rejects.toMatchObject({
      status: 503,
      code: 'AUTHENTICATION_CAPACITY',
    });
    for (const resolve of resolvers.splice(0)) resolve(null);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const next = authenticateProtocol(request(signal.signal), provider, 10);
    const observed = Promise.allSettled([next]);
    await Promise.resolve();
    for (const resolve of resolvers.splice(0)) resolve(null);
    expect((await observed)[0]).toMatchObject({ status: 'rejected', reason: { status: 401 } });
  } finally {
    for (const resolve of resolvers) resolve(null);
    await outcomes;
    vi.useRealTimers();
  }
});

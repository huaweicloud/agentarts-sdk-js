import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import {
  AgentArtsRuntimeApp,
  ConcurrencyLimitError,
  PingStatus,
  RequestContext,
  StreamingResponse,
  type SlotLease,
  type StreamingContent,
} from 'agentarts-sdk/sdk/runtime';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const request = () => ({ json: async () => ({}), headers: {} });
const body = (response: { body: string | Buffer | null }) => JSON.parse(String(response.body));
async function busy(app: AgentArtsRuntimeApp) {
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
  expect(body(await app._handlePing({})).status).toBe(PingStatus.HEALTHY_BUSY);
}
async function rejected(app: AgentArtsRuntimeApp) {
  const result = await app._handleInvocation(request());
  expect(result.statusCode).toBe(503);
  expect(body(result)).toEqual({ error: 'Service busy - maximum concurrency reached' });
}
async function consume(response: StreamingResponse) {
  for await (const _ of response.contentStream) {
    /* consume through cleanup */
  }
}
function iterator(response: StreamingResponse) {
  return (response.contentStream as AsyncIterable<string | Buffer>)[Symbol.asyncIterator]();
}

const servers: Server[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
async function start(app: AgentArtsRuntimeApp) {
  const server = app.run('127.0.0.1', 0);
  servers.push(server);
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function connect(url: string) {
  const socket = new WebSocket(url.replace('http:', 'ws:') + '/ws');
  sockets.push(socket);
  await once(socket, 'open');
  return socket;
}
async function message(socket: WebSocket, input: unknown) {
  const received = once(socket, 'message');
  socket.send(JSON.stringify(input));
  return JSON.parse(String((await received)[0]));
}

describe('shared execution leases', () => {
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid capacity %s',
    (value) => {
      expect(() => new AgentArtsRuntimeApp({ maxConcurrency: value })).toThrow(RangeError);
    },
  );

  it('uses shared capacity and release is idempotent', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 2 });
    const first = app.acquireSlot();
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
    const second = app.acquireSlot();
    await busy(app);
    expect(() => app.acquireSlot()).toThrow(ConcurrencyLimitError);
    first.release();
    first.release();
    const third = app.acquireSlot();
    expect(() => app.acquireSlot()).toThrow(ConcurrencyLimitError);
    second.release();
    third.release();
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  });

  it('HTTP automatically owns exactly one slot until its handler finishes', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    const entered = deferred(),
      finish = deferred();
    app.entrypoint(async () => {
      entered.resolve();
      await finish.promise;
      return { ok: true };
    });
    const first = app._handleInvocation(request());
    await entered.promise;
    try {
      await rejected(app);
      await busy(app);
    } finally {
      finish.resolve();
    }
    expect(body(await first)).toEqual({ ok: true });
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  });

  it('handler errors do not leak capacity', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    app.entrypoint(() => {
      throw new Error('expected');
    });
    expect((await app._handleInvocation(request())).statusCode).toBe(500);
    const lease = app.acquireSlot();
    lease.release();
  });

  it.each(['sync', 'async', 'response'] as const)(
    'holds a %s stream until completion',
    async (kind) => {
      const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
      app.entrypoint(() => {
        if (kind === 'sync')
          return (function* () {
            yield { ok: true };
          })();
        if (kind === 'async')
          return (async function* () {
            yield { ok: true };
          })();
        return new StreamingResponse(['data: {"ok":true}\n\n']);
      });
      const response = (await app._handleInvocation(request())) as StreamingResponse;
      expect(response).toBeInstanceOf(StreamingResponse);
      await rejected(app);
      await busy(app);
      const stream = iterator(response);
      expect((await stream.next()).value).toBe('data: {"ok":true}\n\n');
      await rejected(app);
      expect((await stream.next()).done).toBe(true);
      expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
    },
  );

  it('keeps the slot until asynchronous stream cleanup finishes', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    const cleaning = deferred(),
      finish = deferred();
    app.entrypoint(async function* () {
      try {
        yield 'started';
      } finally {
        cleaning.resolve();
        await finish.promise;
      }
    });
    const stream = iterator((await app._handleInvocation(request())) as StreamingResponse);
    await stream.next();
    const closing = stream.return!();
    await cleaning.promise;
    try {
      await rejected(app);
    } finally {
      finish.resolve();
    }
    await closing;
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  });

  it('closes an unconsumed explicit stream and releases its slot', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let returned = false;
    const stream: AsyncIterableIterator<string> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        throw new Error('must not start');
      },
      async return() {
        returned = true;
        return { done: true, value: undefined };
      },
    };
    app.entrypoint(() => new StreamingResponse(stream));
    const result = (await app._handleInvocation(request())) as StreamingResponse;
    await iterator(result).return!();
    expect(returned).toBe(true);
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  });

  it.each(['sync', 'async', 'response'] as const)('releases a failing %s stream', async (kind) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    app.entrypoint(() => {
      const stream =
        kind === 'sync'
          ? (function* () {
              throw new Error('stream failed');
              yield '';
            })()
          : (async function* () {
              throw new Error('stream failed');
              yield '';
            })();
      return kind === 'response' ? new StreamingResponse(stream as StreamingContent) : stream;
    });
    const response = (await app._handleInvocation(request())) as StreamingResponse;
    if (kind === 'response') await expect(consume(response)).rejects.toThrow('stream failed');
    else await consume(response); // existing SSE error framing stays intact
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  });

  it('capacity overrides custom Healthy, but preserves forced/unhealthy/initing states', async () => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    const lease = app.acquireSlot();
    app.ping(() => PingStatus.HEALTHY);
    await busy(app);
    app.ping(async () => PingStatus.HEALTHY);
    expect(body(await app._handlePing({})).status).toBe(PingStatus.HEALTHY_BUSY);
    for (const status of [PingStatus.UNHEALTHY, PingStatus.INITING]) {
      app.ping(() => status);
      expect(app.getCurrentPingStatus()).toBe(status);
      expect(body(await app._handlePing({})).status).toBe(status);
    }
    app.forcePingStatus(PingStatus.HEALTHY);
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
    lease.release();
  });
});

it('real HTTP and WS share capacity; idle sockets are free and busy errors keep the connection usable', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const entered = deferred(),
    finish = deferred();
  let active = 0,
    peak = 0;
  app.entrypoint(async () => {
    entered.resolve();
    await finish.promise;
    return { ok: true };
  });
  const rounds = new Map<string, ReturnType<typeof deferred>>();
  app.websocket(async (ws) => {
    const running: Promise<void>[] = [];
    try {
      while (true) {
        const input = await ws.receiveJson();
        let lease: SlotLease;
        try {
          lease = app.acquireSlot();
        } catch (err) {
          if (!(err instanceof ConcurrencyLimitError)) throw err;
          await ws.sendJson({ sessionId: input.sessionId, error: err.code });
          continue;
        }
        const gate = deferred();
        rounds.set(input.sessionId, gate);
        running.push(
          (async () => {
            active++;
            peak = Math.max(peak, active);
            try {
              await ws.sendJson({ sessionId: input.sessionId, started: true });
              await gate.promise;
            } finally {
              active--;
              lease.release();
            }
          })(),
        );
      }
    } finally {
      await Promise.all(running);
    }
  });
  const url = await start(app);
  const first = await connect(url),
    second = await connect(url);
  const http = fetch(url + '/invocations', { method: 'POST', body: '{}' });
  await entered.promise; // idle sockets did not consume the HTTP slot
  expect(await message(first, { sessionId: 'during-http' })).toEqual({
    sessionId: 'during-http',
    error: 'CONCURRENCY_LIMIT_EXCEEDED',
  });
  expect(((await (await fetch(url + '/ping')).json()) as { status: string }).status).toBe(
    PingStatus.HEALTHY_BUSY,
  );
  finish.resolve();
  expect((await http).status).toBe(200);
  try {
    expect(await message(first, { sessionId: 'one' })).toEqual({ sessionId: 'one', started: true });
    for (const socket of [first, second]) {
      expect((await message(socket, { sessionId: 'two' })).error).toBe(
        'CONCURRENCY_LIMIT_EXCEEDED',
      );
    }
    expect((await fetch(url + '/invocations', { method: 'POST', body: '{}' })).status).toBe(503);
    expect(((await (await fetch(url + '/ping')).json()) as { status: string }).status).toBe(
      PingStatus.HEALTHY_BUSY,
    );
    rounds.get('one')!.resolve();
    await expect.poll(() => active).toBe(0);
    expect((await message(second, { sessionId: 'three' })).started).toBe(true);
    expect(peak).toBe(1);
  } finally {
    for (const gate of rounds.values()) gate.resolve();
  }
  await expect.poll(() => active).toBe(0);
  expect(((await (await fetch(url + '/ping')).json()) as { status: string }).status).toBe(
    PingStatus.HEALTHY,
  );
});

it('HTTP disconnect aborts execution but keeps capacity until the child exits and cleanup completes', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const started = deferred(),
    cancelled = deferred(),
    finishCleanup = deferred(),
    finished = deferred();
  app.entrypoint(async (_payload: unknown, context?: RequestContext) => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const exited = once(child, 'exit');
    const abort = () => {
      child.kill();
      cancelled.resolve();
    };
    context!.signal!.addEventListener('abort', abort, { once: true });
    started.resolve();
    try {
      await exited;
      await finishCleanup.promise;
      return {};
    } finally {
      context!.signal!.removeEventListener('abort', abort);
      child.kill();
      finished.resolve();
    }
  });
  const url = await start(app);
  const controller = new AbortController();
  const pending = fetch(url + '/invocations', {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
  }).catch(() => undefined);
  await started.promise;
  controller.abort();
  await cancelled.promise;
  try {
    expect((await fetch(url + '/invocations', { method: 'POST', body: '{}' })).status).toBe(503);
  } finally {
    finishCleanup.resolve();
  }
  await finished.promise;
  await pending;
  await expect.poll(() => app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('SSE disconnect cancels a pending next() and retains capacity throughout generator cleanup', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const cleaning = deferred(),
    finish = deferred();
  app.entrypoint(async function* (_payload: unknown, context?: RequestContext) {
    try {
      yield { started: true };
      await new Promise<void>((resolve) => {
        if (context!.signal!.aborted) resolve();
        else context!.signal!.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      cleaning.resolve();
      await finish.promise;
    }
  });
  const url = await start(app);
  const controller = new AbortController();
  const response = await fetch(url + '/invocations', {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
  });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"started":true}\n\n');
  controller.abort();
  await cleaning.promise;
  try {
    expect((await fetch(url + '/invocations', { method: 'POST', body: '{}' })).status).toBe(503);
  } finally {
    finish.resolve();
  }
  await reader.cancel().catch(() => {});
  await expect.poll(() => app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('closes an explicit stream returned after the HTTP peer has already disconnected', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const entered = deferred(),
    aborted = deferred(),
    finish = deferred(),
    closed = deferred();
  app.entrypoint(async (_payload: unknown, context?: RequestContext) => {
    context!.signal!.addEventListener('abort', () => aborted.resolve(), { once: true });
    entered.resolve();
    await finish.promise;
    return new StreamingResponse({
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new Error('unconsumed stream must not run');
          },
          async return() {
            closed.resolve();
            return { done: true, value: undefined };
          },
        };
      },
    });
  });
  const url = await start(app);
  const controller = new AbortController();
  const pending = fetch(url + '/invocations', {
    method: 'POST',
    body: '{}',
    signal: controller.signal,
  }).catch(() => undefined);
  await entered.promise;
  controller.abort();
  await aborted.promise;
  try {
    await rejected(app);
  } finally {
    finish.resolve();
  }
  await closed.promise;
  await pending;
  await expect.poll(() => app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('WS disconnect signals cancellation and does not return a round slot before cleanup', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const cancelled = deferred(),
    finish = deferred(),
    done = deferred();
  app.entrypoint(() => ({ ok: true }));
  app.websocket(async (ws, context) => {
    await ws.receiveJson();
    const lease = app.acquireSlot();
    try {
      await ws.sendJson({ started: true });
      await new Promise<void>((resolve) =>
        context.signal!.addEventListener(
          'abort',
          () => {
            cancelled.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      await finish.promise;
    } finally {
      lease.release();
      done.resolve();
    }
  });
  const url = await start(app);
  const ws = await connect(url);
  expect((await message(ws, {})).started).toBe(true);
  ws.terminate();
  await cancelled.promise;
  try {
    expect((await fetch(url + '/invocations', { method: 'POST', body: '{}' })).status).toBe(503);
  } finally {
    finish.resolve();
  }
  await done.promise;
  expect((await fetch(url + '/invocations', { method: 'POST', body: '{}' })).status).toBe(200);
});

it('a pending next completing during return does not release before custom cleanup', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const nextDone = deferred(),
    cleaning = deferred(),
    finish = deferred();
  const source: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      await nextDone.promise;
      return { done: true as const, value: undefined };
    },
    async return() {
      cleaning.resolve();
      await finish.promise;
      return { done: true as const, value: undefined };
    },
  };
  app.entrypoint(() => new StreamingResponse(source));
  const stream = iterator((await app._handleInvocation(request())) as StreamingResponse);
  const pending = stream.next();
  const closing = stream.return!();
  await cleaning.promise;
  nextDone.resolve();
  await pending;
  try {
    await rejected(app);
  } finally {
    finish.resolve();
  }
  await closing;
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('preserves explicit streaming response status, headers and media type without mutating it', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const original = new StreamingResponse(['raw'], {
    statusCode: 202,
    headers: { 'x-custom': 'value' },
    mediaType: 'text/plain',
  });
  app.entrypoint(() => original);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  expect(response.statusCode).toBe(202);
  expect(response.headers).toEqual({ 'x-custom': 'value' });
  expect(response.mediaType).toBe('text/plain');
  expect(original.contentStream).toEqual(['raw']);
  await consume(response);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('supports a string iterable in an explicit streaming response', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  app.entrypoint(() => new StreamingResponse('raw', { mediaType: 'text/plain' }));
  const url = await start(app);
  const response = await fetch(url + '/invocations', { method: 'POST', body: '{}' });
  expect(await response.text()).toBe('raw');
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it.each(['sync', 'async'] as const)(
  'closes an unstarted raw %s source before restoring capacity',
  async (kind) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let cleaned = 0;
    const source =
      kind === 'sync'
        ? {
            [Symbol.iterator]() {
              return this;
            },
            next() {
              return { done: false, value: 'running' };
            },
            return() {
              cleaned++;
              return { done: true, value: undefined };
            },
          }
        : {
            [Symbol.asyncIterator]() {
              return this;
            },
            async next() {
              return { done: false, value: 'running' };
            },
            async return() {
              cleaned++;
              return { done: true, value: undefined };
            },
          };
    app.entrypoint(() => source);
    const response = (await app._handleInvocation(request())) as StreamingResponse;
    const stream = iterator(response);
    await stream.return!();
    await stream.return!();
    expect(cleaned).toBe(1);
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  },
);

it('waits for cleanup of an unstarted raw source before releasing its lease', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const cleaning = deferred(),
    finish = deferred();
  const source: AsyncIterableIterator<unknown> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      throw new Error('must not start');
    },
    async return() {
      cleaning.resolve();
      await finish.promise;
      return { done: true, value: undefined };
    },
  };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  const closing = iterator(response).return!();
  await cleaning.promise;
  try {
    await rejected(app);
    await busy(app);
  } finally {
    finish.resolve();
  }
  await closing;
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('cleans the stream and restores capacity when response header initialization fails', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let cleaned = 0;
  const source: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      throw new Error('header failure must prevent stream execution');
    },
    async return() {
      cleaned++;
      return { done: true, value: undefined };
    },
  };
  app.entrypoint(() => new StreamingResponse(source, { mediaType: 'invalid\nmedia-type' }));
  const url = await start(app);
  const response = await fetch(url + '/invocations', { method: 'POST', body: '{}' });
  expect(response.status).toBe(500);
  await response.text();
  expect(cleaned).toBe(1);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  app.entrypoint(() => ({ ok: true }));
  const next = await fetch(url + '/invocations', { method: 'POST', body: '{}' });
  expect(next.status).toBe(200);
  expect(await next.json()).toEqual({ ok: true });
});

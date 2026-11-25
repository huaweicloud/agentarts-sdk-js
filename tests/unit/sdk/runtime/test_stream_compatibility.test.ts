import { expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { AgentArtsRuntimeApp, PingStatus, StreamingResponse } from 'agentarts-sdk/sdk/runtime';
const request = () => ({ json: async () => ({}), headers: {} });
async function collect(response: StreamingResponse) {
  const chunks: Array<string | Buffer> = [];
  for await (const chunk of response.contentStream) chunks.push(chunk);
  return chunks;
}

it.each(['sync', 'async'])(
  'does not cancel a naturally exhausted explicit %s iterator',
  async (kind) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let cancellations = 0;
    const source =
      kind === 'sync'
        ? {
            [Symbol.iterator]() {
              return this;
            },
            next() {
              return { done: true as const, value: undefined };
            },
            return() {
              cancellations++;
              throw new Error('cannot cancel an already completed execution');
            },
          }
        : {
            [Symbol.asyncIterator]() {
              return this;
            },
            async next() {
              return { done: true as const, value: undefined };
            },
            async return() {
              cancellations++;
              throw new Error('cannot cancel an already completed execution');
            },
          };
    app.entrypoint(() => new StreamingResponse(source));
    const response = (await app._handleInvocation(request())) as StreamingResponse;
    await expect(collect(response)).resolves.toEqual([]);
    expect(cancellations).toBe(0);
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  },
);

it('preserves an explicitly disabled Content-Type when wrapping StreamingResponse', async () => {
  const app = new AgentArtsRuntimeApp();
  const original = new StreamingResponse(['raw']);
  original.mediaType = null; // Response.mediaType is a public string | null property.
  app.entrypoint(() => original);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  try {
    expect(response.mediaType).toBeNull();
  } finally {
    await collect(response);
  }
});

it('retains SSE error framing when execution and resource cleanup both fail', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const logged = vi.spyOn(app.logger, 'exception').mockImplementation(() => {});
  const source: AsyncIterableIterator<unknown> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      throw new Error('business execution failed');
    },
    async return() {
      throw new Error('cleanup also failed');
    },
  };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
  await expect(stream.next()).resolves.toMatchObject({
    done: false,
    value: expect.stringContaining('data: '),
  });
  expect(logged).toHaveBeenCalledWith(expect.stringContaining('cleanup also failed'));
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it.each(['sync', 'async'])('closes an unconsumed %s source exactly once', async (kind) => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let closes = 0;
  const source =
    kind === 'sync'
      ? {
          [Symbol.iterator]() {
            return this;
          },
          next() {
            return { done: false, value: 'raw' };
          },
          return() {
            closes++;
            return { done: true, value: undefined };
          },
        }
      : {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            return { done: false, value: 'raw' };
          },
          async return() {
            closes++;
            return { done: true, value: undefined };
          },
        };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
  await Promise.all([stream.return!(), stream.return!()]);
  expect(closes).toBe(1);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it.each([false, true])(
  'keeps SSE framing when execution and cleanup fail (first chunk sent: %s)',
  async (emitFirst) => {
    const app = new AgentArtsRuntimeApp();
    let sent = false;
    const source: AsyncIterableIterator<unknown> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (emitFirst && !sent) {
          sent = true;
          return { done: false, value: 'started' };
        }
        throw new Error('execution failed');
      },
      async return() {
        throw new Error('cleanup failed');
      },
    };
    app.entrypoint(() => source);
    const server = app.run('127.0.0.1', 0);
    await once(server, 'listening');
    const address = server.address() as import('node:net').AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/invocations`, {
        method: 'POST',
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      const frames = await response.text();
      expect(frames).toContain('data: ');
      expect(frames).toContain('\"error\":\"execution failed\"');
      if (emitFirst) expect(frames).toContain('started');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it.each([false, true])(
  'does not cancel a normally completed HTTP stream (explicit: %s)',
  async (explicit) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let chunks = 0,
      cancellations = 0;
    const source: AsyncIterableIterator<string> = {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        return chunks++ === 0 ? { done: false, value: 'raw' } : { done: true, value: undefined };
      },
      async return() {
        cancellations++;
        throw new Error('execution already completed');
      },
    };
    app.entrypoint(() => (explicit ? new StreamingResponse(source) : source));
    const server = app.run('127.0.0.1', 0);
    await once(server, 'listening');
    const address = server.address() as import('node:net').AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/invocations`, {
        method: 'POST',
        body: '{}',
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(explicit ? 'raw' : 'data: "raw"\n\n');
      expect(cancellations).toBe(0);
      expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

it('omits Content-Type over HTTP when the explicit response disables it', async () => {
  const app = new AgentArtsRuntimeApp();
  const original = new StreamingResponse(['raw']);
  original.mediaType = null;
  app.entrypoint(() => original);
  const server = app.run('127.0.0.1', 0);
  await once(server, 'listening');
  const address = server.address() as import('node:net').AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/invocations`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.headers.get('content-type')).toBeNull();
    expect(await response.text()).toBe('raw');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not suppress cleanup failure when a raw SSE stream is explicitly cancelled', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let entered!: () => void, rejectNext!: (error: Error) => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const source: AsyncIterableIterator<unknown> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    next() {
      entered();
      return new Promise((_resolve, reject) => {
        rejectNext = reject;
      });
    },
    async return() {
      rejectNext(new Error('execution cancelled'));
      throw new Error('cleanup failed');
    },
  };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation(request())) as StreamingResponse;
  const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
  const pending = Promise.allSettled([stream.next()]);
  await started;
  const closing = await Promise.allSettled([stream.return!()]);
  expect(closing[0]!.status).toBe('rejected');
  expect((await pending)[0]!.status).toBe('rejected');
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

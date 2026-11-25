import { expect, it } from 'vitest';
import { AgentArtsRuntimeApp, PingStatus, StreamingResponse } from 'agentarts-sdk/sdk/runtime';

it.each(['sync', 'async'])('cleans a started raw %s iterator when next throws', async (kind) => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let cleaned = false;
  const source =
    kind === 'sync'
      ? {
          [Symbol.iterator]() {
            return this;
          },
          next() {
            throw new Error('execution failed');
          },
          return() {
            cleaned = true;
            return { done: true, value: undefined };
          },
        }
      : {
          [Symbol.asyncIterator]() {
            return this;
          },
          async next() {
            throw new Error('execution failed');
          },
          async return() {
            cleaned = true;
            return { done: true, value: undefined };
          },
        };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation({
    json: async () => ({}),
    headers: {},
  })) as StreamingResponse;
  for await (const _ of response.contentStream) {
    /* preserve existing SSE error frame */
  }
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  expect(cleaned, 'raw execution resources must be cleaned before slot release').toBe(true);
});

it('does not release an explicit stream while its next is still executing', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let finish!: () => void;
  const running = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const source: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      await running;
      return { done: true, value: undefined };
    },
  };
  app.entrypoint(() => new StreamingResponse(source));
  const response = (await app._handleInvocation({
    json: async () => ({}),
    headers: {},
  })) as StreamingResponse;
  const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
  const pending = stream.next();
  const closing = stream.return!();
  try {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
  } finally {
    finish();
    await pending;
    await closing;
  }
});

it.each([false, true])(
  'does not deadlock when return rejects pending next (cleanup fails: %s)',
  async (cleanupFails) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let entered!: () => void, rejectNext!: (error: Error) => void;
    let cleaning!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cleanupStarted = new Promise<void>((resolve) => {
      cleaning = resolve;
    });
    const cleanupGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const source: AsyncIterableIterator<string> = {
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
        cleaning();
        await cleanupGate;
        if (cleanupFails) throw new Error('cleanup failed');
        return { done: true, value: undefined };
      },
    };
    app.entrypoint(() => new StreamingResponse(source));
    const response = (await app._handleInvocation({
      json: async () => ({}),
      headers: {},
    })) as StreamingResponse;
    const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
    const pending = stream.next();
    const observed = Promise.allSettled([pending]);
    await started;
    const closing = stream.return!();
    const closed = Promise.allSettled([closing]);
    await cleanupStarted;
    try {
      expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
    } finally {
      finish();
    }
    expect((await observed)[0]!.status).toBe('rejected');
    expect((await closed)[0]!.status).toBe(cleanupFails ? 'rejected' : 'fulfilled');
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  },
);

it('keeps capacity until raw next failure cleanup completes and preserves its SSE error frame', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  let cleaning!: () => void, finish!: () => void;
  let returns = 0;
  const started = new Promise<void>((resolve) => {
    cleaning = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const source: AsyncIterableIterator<string> = {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      throw new Error('execution failed');
    },
    async return() {
      returns++;
      cleaning();
      await gate;
      return { done: true, value: undefined };
    },
  };
  app.entrypoint(() => source);
  const response = (await app._handleInvocation({
    json: async () => ({}),
    headers: {},
  })) as StreamingResponse;
  const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
  const pending = stream.next();
  await started;
  try {
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
  } finally {
    finish();
  }
  const frame = await pending;
  expect(String(frame.value)).toContain('"error":"execution failed"');
  expect(String(frame.value)).toContain('Error occurred during async stream generation');
  await stream.return!();
  expect(returns).toBe(1);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it.each([false, true])(
  'finishes cleanup when a generator yields from finally (explicit response: %s)',
  async (explicit) => {
    const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
    let cleaning!: () => void, finish!: () => void;
    let cleaned = false;
    const started = new Promise<void>((resolve) => {
      cleaning = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    app.entrypoint(() => {
      const source = (async function* () {
        try {
          yield 'started';
        } finally {
          yield 'cleanup';
          cleaning();
          await gate;
          cleaned = true;
        }
      })();
      return explicit ? new StreamingResponse(source) : source;
    });
    const response = (await app._handleInvocation({
      json: async () => ({}),
      headers: {},
    })) as StreamingResponse;
    const stream = (response.contentStream as AsyncIterable<string>)[Symbol.asyncIterator]();
    await stream.next();
    const closing = stream.return!();
    await started;
    try {
      expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
    } finally {
      finish();
    }
    await closing;
    expect(cleaned).toBe(true);
    expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
  },
);

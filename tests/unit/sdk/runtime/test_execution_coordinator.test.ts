import { expect, it, vi } from 'vitest';
import {
  AgentArtsRuntimeApp,
  ExecutionError,
  ExecutionCoordinator,
  ConcurrencyLimitError,
  PingStatus,
} from 'agentarts-sdk/sdk/runtime';
const alice = { tenantId: 'tenant-a', subject: 'alice' };
const bob = { tenantId: 'tenant-a', subject: 'bob' };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('executes without subscribers and shares capacity with legacy HTTP', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  app.entrypoint(() => 'legacy');
  const finish = deferred();
  const execution = app.executions.start(alice, 'a', {}, async (_input, context) => {
    context.emitText('hello');
    await finish.promise;
    context.emitText(' world');
  });
  expect((await app._handleInvocation({ json: async () => ({}) })).statusCode).toBe(503);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY_BUSY);
  finish.resolve();
  expect(await execution.done).toEqual({ state: 'completed', output: 'hello world' });
  expect((await app._handleInvocation({ json: async () => ({}) })).statusCode).toBe(200);
});

it('legacy HTTP owns the same permit used by new protocols', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const entered = deferred(),
    finish = deferred();
  app.entrypoint(async () => {
    entered.resolve();
    await finish.promise;
  });
  const legacy = app._handleInvocation({ json: async () => ({}) });
  await entered.promise;
  try {
    expect(() => app.executions.start(alice, 'a', {}, () => '')).toThrow(ConcurrencyLimitError);
  } finally {
    finish.resolve();
    await legacy;
  }
});

it('deduplicates atomically, rejects changed input and isolates users and tenants', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 4 });
  const finish = deferred();
  let starts = 0;
  const execute = async () => {
    starts++;
    await finish.promise;
    return 'done';
  };
  const handles = Array.from({ length: 20 }, () =>
    app.executions.start(alice, 'a', { x: 1, y: 2 }, execute),
  );
  expect(new Set(handles).size).toBe(1);
  expect(app.executions.start(alice, 'a', { y: 2, x: 1 }, execute)).toBe(handles[0]);
  expect(() => app.executions.start(alice, 'a', { x: 2 }, execute)).toThrow(ExecutionError);
  expect(() => app.executions.getById(bob, handles[0]!.executionId)).toThrow(/not found/);
  expect(() => app.executions.get({ ...alice, tenantId: 'tenant-b' }, 'a')).toThrow(/not found/);
  const other = app.executions.start(bob, 'a', {}, execute);
  expect(other.executionId).not.toBe(handles[0]!.executionId);
  expect(starts).toBe(2);
  finish.resolve();
  await Promise.all([other.done, handles[0]!.done]);
});

it('retains the permit until cancellation cleanup completes, and cancel is idempotent', async () => {
  const app = new AgentArtsRuntimeApp({ maxConcurrency: 1 });
  const cleaning = deferred(),
    finish = deferred();
  let signals = 0;
  const handle = app.executions.start(alice, 'a', {}, async (_input, context) => {
    await new Promise<void>((resolve) =>
      context.signal.addEventListener(
        'abort',
        () => {
          signals++;
          resolve();
        },
        { once: true },
      ),
    );
    cleaning.resolve();
    await finish.promise;
  });
  const first = handle.cancel(),
    second = handle.cancel();
  await cleaning.promise;
  expect(handle.outcome).toBeUndefined();
  expect(() => app.acquireSlot()).toThrow();
  finish.resolve();
  expect(await first).toEqual({ state: 'canceled' });
  expect(await second).toEqual({ state: 'canceled' });
  expect(signals).toBe(1);
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('does not evict retained completions early or restart duplicate messages', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const app = new AgentArtsRuntimeApp({ executionLimits: { maxExecutions: 1, retentionMs: 100 } });
  let starts = 0;
  const execute = () => {
    starts++;
    return 'done';
  };
  const first = app.executions.start(alice, 'first', {}, execute);
  await first.done;
  expect(() => app.executions.start(alice, 'second', {}, execute)).toThrow(/registry full/);
  expect(app.executions.start(alice, 'first', {}, execute)).toBe(first);
  expect(starts).toBe(1);
  now += 101;
  expect(() => app.executions.get(alice, 'first')).toThrow(/not found/);
  await app.executions.start(alice, 'second', {}, execute).done;
  expect(starts).toBe(2);
});

it('bounds replay history and drops only the slow subscriber, not the execution', async () => {
  const app = new AgentArtsRuntimeApp({ executionLimits: { maxEvents: 2, maxSubscribers: 1 } });
  const finish = deferred();
  let emit!: (text: string) => void;
  const handle = app.executions.start(alice, 'a', {}, async (_input, context) => {
    emit = context.emitText;
    await finish.promise;
  });
  const events = handle.events();
  expect(() => handle.events()).toThrow(/Subscriber limit/);
  emit('1');
  emit('2');
  emit('3');
  await expect(events.next()).rejects.toMatchObject({ code: 'HISTORY_LOST' });
  expect(handle.outcome).toBeUndefined();
  const replacement = handle.events(handle.sequence);
  await replacement.return!();
  finish.resolve();
  await handle.done;
});

it('aborted/unconsumed subscriptions free their own quota without canceling execution', async () => {
  const app = new AgentArtsRuntimeApp({ executionLimits: { maxSubscribers: 1 } });
  const finish = deferred();
  const handle = app.executions.start(alice, 'a', {}, async () => {
    await finish.promise;
  });
  const signal = new AbortController();
  const first = handle.events(0, signal.signal);
  signal.abort();
  const second = handle.events();
  await second.return!();
  await first.return!();
  expect(handle.outcome).toBeUndefined();
  finish.resolve();
  await handle.done;
});

it('rejects excessive output and freezes the authenticated principal and input snapshot', async () => {
  const app = new AgentArtsRuntimeApp({ executionLimits: { maxOutputBytes: 4 } });
  const input = { nested: { value: 1 } };
  const handle = app.executions.start(alice, 'a', input, (value, context) => {
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen((value as typeof input).nested)).toBe(true);
    expect(Object.isFrozen(context.principal)).toBe(true);
    context.emitText('12345');
  });
  input.nested.value = 99;
  expect(await handle.done).toEqual({ state: 'failed' });
  expect(handle.input).toEqual({ nested: { value: 1 } });
  expect(app.getCurrentPingStatus()).toBe(PingStatus.HEALTHY);
});

it('does not expose provider exception messages in outcomes or replay', async () => {
  const app = new AgentArtsRuntimeApp();
  const handle = app.executions.start(alice, 'a', {}, () => {
    throw new Error('SECRET-provider-key');
  });
  await handle.done;
  const events = [];
  for await (const event of handle.events()) events.push(event);
  expect(JSON.stringify({ outcome: handle.outcome, events })).not.toContain('SECRET');
});

it('times out cooperatively without freeing capacity before cleanup', async () => {
  vi.useFakeTimers();
  const app = new AgentArtsRuntimeApp({ executionLimits: { executionTimeoutMs: 20 } });
  const finish = deferred();
  const handle = app.executions.start(alice, 'a', {}, async (_input, context) => {
    await new Promise<void>((resolve) =>
      context.signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    await finish.promise;
  });
  try {
    await vi.advanceTimersByTimeAsync(20);
    expect(handle.outcome).toBeUndefined();
    finish.resolve();
    expect((await handle.done).state).toBe('canceled');
  } finally {
    finish.resolve();
    await handle.done;
    vi.useRealTimers();
  }
});

it.each([NaN, Infinity, 0, -1, 1.5])('rejects invalid execution limits %s', (value) => {
  expect(
    () => new ExecutionCoordinator(() => ({ release() {} }), { maxExecutions: value }),
  ).toThrow();
});

it('accounts for JSON escaping in event limits without leaving a replay sequence gap', async () => {
  const app = new AgentArtsRuntimeApp({
    executionLimits: { maxHistoryBytes: 256, maxOutputBytes: 512 },
  });
  const handle = app.executions.start(alice, 'escaped', {}, (_input, context) =>
    context.emitText('"'.repeat(200)),
  );
  expect((await handle.done).state).toBe('failed');
  const events = [];
  for await (const event of handle.events()) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0]!.type).toBe('finished');
  expect(handle.output).toBe('');
});

it('bounds per-principal records without denying other authenticated users', async () => {
  const app = new AgentArtsRuntimeApp({
    executionLimits: { maxExecutions: 3, maxExecutionsPerPrincipal: 1 },
  });
  await app.executions.start(alice, 'one', {}, () => 'done').done;
  expect(() => app.executions.start(alice, 'two', {}, () => '')).toThrow(/Principal/);
  expect((await app.executions.start(bob, 'one', {}, () => 'done').done).state).toBe('completed');
});

it('bounds active executions per principal while preserving shared global capacity', async () => {
  const app = new AgentArtsRuntimeApp({
    maxConcurrency: 3,
    executionLimits: { maxActivePerPrincipal: 1 },
  });
  const finish = deferred();
  const first = app.executions.start(alice, 'one', {}, async () => {
    await finish.promise;
  });
  try {
    expect(() => app.executions.start(alice, 'two', {}, () => '')).toThrow(/Principal/);
    expect((await app.executions.start(bob, 'one', {}, () => 'done').done).state).toBe('completed');
  } finally {
    finish.resolve();
    await first.done;
  }
});

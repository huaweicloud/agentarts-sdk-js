import { createHash, randomUUID } from 'node:crypto';
import { EventEncoder } from '@ag-ui/encoder';
import { EventType } from '@ag-ui/core';
import type { Event, RunAgentInput, RunFinishedOutcome, Interrupt, ToolMessage } from '@ag-ui/core';
import { InterruptSchema } from '@ag-ui/core/schemas';
import {
  MemoryProtocolStorage, ProtocolEventJournal, ProtocolHttpError, Response, StreamingResponse,
  authenticateProtocol, protocolCors, protocolFailure, protocolOrigins, protocolSnapshot, requireIdentifier,
  protocolFingerprint, boundedInteger,
  type ProtocolAuthenticator, type ProtocolStorage, type RuntimeProtocol, type ExecutionPrincipal,
} from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { textInput } from './input.js';
import { AguiSession } from './session.js';

export interface AguiAgentContext {
  readonly principal: ExecutionPrincipal;
  readonly signal: AbortSignal;
  readonly checkpoint: unknown;
  readonly resume: NonNullable<RunAgentInput['resume']>;
  readonly state: unknown;
  emit(event: Event): void;
  emitText(delta: string): void;
  saveCheckpoint(value: unknown): Promise<void>;
  callTool(name: string, args: unknown): string;
  toolResult(id: string, content: ToolMessage['content']): void;
  interrupt(interrupts: Interrupt[], checkpoint?: unknown): AguiAgentResult;
}
export interface AguiAgentResult { result?: unknown; outcome?: RunFinishedOutcome }
export interface AguiAgentOptions {
  authenticate: ProtocolAuthenticator;
  execute: (input: RunAgentInput, context: AguiAgentContext) => AguiAgentResult | void | Promise<AguiAgentResult | void>;
  storage?: ProtocolStorage;
  path?: string;
  namespace?: string;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  executionTimeoutMs?: number;
  maxOutputBytes?: number;
}
interface RunRecord { id: string; fingerprint: string; status: 'running' | 'finished' | 'failed'; outcome?: RunFinishedOutcome; result?: unknown; messages: RunAgentInput['messages']; state: unknown }
interface ThreadRecord { owner?: string; checkpoint?: unknown; interrupts: Interrupt[]; runs: RunRecord[] }
function compact(record: ThreadRecord): ThreadRecord {
  const snapshot = { ...record, runs: [...record.runs] };
  while (snapshot.runs.length > 1 && Buffer.byteLength(JSON.stringify(snapshot)) > 3 * 1024 * 1024) snapshot.runs.shift();
  return snapshot;
}
const eventWindowBytes = 512 * 1024;
const instances = new Map<string, Set<string>>();

/** Full AG-UI producer: official event verification plus persisted, identity-scoped thread checkpoints. */
export function createAguiAgent(options: AguiAgentOptions): RuntimeProtocol {
  const path = options.path ?? '/ag-ui';
  const namespace = options.namespace ?? `agui:${path}`;
  const storage = options.storage ?? new MemoryProtocolStorage();
  const origins = protocolOrigins(options.allowedOrigins);
  const instance = randomUUID();
  instances.set(instance, new Set());
  let stopping = false;
  const claims = new Set<Promise<void>>();
  const live = new Map<string, { cancel(): void; done: Promise<void> }>();
  const encoder = new EventEncoder({ accept: 'text/event-stream' });
  boundedInteger(options.executionTimeoutMs ?? 120000, 'executionTimeoutMs', 2147483647);
  boundedInteger(options.maxOutputBytes ?? 1024 * 1024, 'maxOutputBytes', 16 * 1024 * 1024);
  if (typeof options.authenticate !== 'function' || typeof options.execute !== 'function') throw new TypeError('authenticate and execute are required');
  return {
    routes: [{ path, methods: ['POST', 'OPTIONS'] }],
    async shutdown() {
      stopping = true;
      await Promise.all(claims);
      const active = [...live.values()]; for (const run of active) run.cancel();
      await Promise.all(active.map(run => run.done)); instances.delete(instance);
    },
    async handle(request, host) {
      let cors: Record<string, string> = {};
      try {
        cors = protocolCors(request, origins, ['POST'], ['authorization', 'content-type']);
        if (request.method === 'OPTIONS') return new Response({ statusCode: 204, headers: cors });
        if (stopping) throw new ProtocolHttpError(503, 'SHUTTING_DOWN', 'Agent is shutting down');
        const principal = await authenticateProtocol(request, options.authenticate);
        const input = textInput(await request.json(options.maxBodyBytes, options.bodyTimeoutMs), message => host.logger.warn(message), true);
        requireIdentifier(input.threadId, 'threadId'); requireIdentifier(input.runId, 'runId');
        const scope = createHash('sha256').update(JSON.stringify([namespace, principal.tenantId, principal.subject])).digest('hex');
        const key = input.threadId;
        const local = `${scope}:${key}`;
        if (live.has(local)) throw new ProtocolHttpError(409, 'RUN_ALREADY_ACTIVE', 'Thread already has an active run');
        const fingerprint = protocolFingerprint(input);
        const previous = await storage.get<ThreadRecord>(scope, key);
        const old = previous?.runs.find(run => run.id === input.runId);
        if (old) {
          if (old.fingerprint !== fingerprint) throw new ProtocolHttpError(409, 'RUN_CONFLICT', 'Run id already used with different input');
          if (old.status === 'running') throw new ProtocolHttpError(409, 'RUN_INTERRUPTED', 'Interrupted execution requires a new run id');
          const replay: Event[] = [
            { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId, protocolVersion: '1.0' },
            { type: EventType.MESSAGES_SNAPSHOT, messages: old.messages },
            { type: EventType.STATE_SNAPSHOT, snapshot: old.state },
            old.status === 'failed' ? { type: EventType.RUN_ERROR, message: 'Agent execution failed', code: 'EXECUTION_FAILED' }
              : { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId, outcome: old.outcome!, ...(old.result !== undefined ? { result: old.result } : {}) },
          ];
          return new StreamingResponse((async function* () { for (const event of replay) yield encoder.encodeSSE(event); })(), { headers: cors });
        }
        const openInterrupts = previous?.interrupts ?? [];
        const supplied = new Map(input.resume?.map(entry => [entry.interruptId, entry]) ?? []);
        if (supplied.size !== (input.resume?.length ?? 0)) throw new ProtocolHttpError(400, 'INVALID_RESUME', 'Duplicate resume entries');
        for (const interrupt of openInterrupts) {
          const answer = supplied.get(interrupt.id);
          if (!answer) throw new ProtocolHttpError(400, 'INCOMPLETE_RESUME', 'Every pending interrupt needs an explicit answer');
          if (answer.status === 'resolved' && interrupt.expiresAt && Number.isFinite(Date.parse(interrupt.expiresAt)) && Date.parse(interrupt.expiresAt) <= Date.now())
            throw new ProtocolHttpError(400, 'EXPIRED_INTERRUPT', 'Expired interrupt must be cancelled');
        }
        if ([...supplied.keys()].some(id => !openInterrupts.some(interrupt => interrupt.id === id))) host.logger.warn('AG-UI ignored unknown resume entries');
        let claimedPrior = previous;
        if (stopping) throw new ProtocolHttpError(503, 'SHUTTING_DOWN', 'Agent is shutting down');
        const lease = host.acquireSlot();
        const controller = new AbortController();
        const journal = new ProtocolEventJournal<Event>(256, eventWindowBytes);
        let done!: () => void;
        const finished = new Promise<void>(resolve => { done = resolve; });
        let releaseClaim!: () => void;
        const claim = new Promise<void>(resolve => { releaseClaim = resolve; });
        claims.add(claim);
        try {
          await storage.update<ThreadRecord>(scope, key, record => {
            if ((record?.owner && instances.has(record.owner) && !instances.get(record.owner)!.has(local)) || live.has(local)) throw new ProtocolHttpError(409, 'RUN_ALREADY_ACTIVE', 'Thread already active');
            if (record?.runs.some(run => run.id === input.runId)) throw new ProtocolHttpError(409, 'RUN_ALREADY_EXISTS', 'Run id already claimed');
            for (const pending of record?.interrupts ?? []) {
              const answer = supplied.get(pending.id);
              if (!answer) throw new ProtocolHttpError(400, 'INCOMPLETE_RESUME', 'Every pending interrupt needs an explicit answer');
              if (answer.status === 'resolved' && pending.expiresAt && Date.parse(pending.expiresAt) <= Date.now()) throw new ProtocolHttpError(400, 'EXPIRED_INTERRUPT', 'Expired interrupt must be cancelled');
            }
            claimedPrior = record;
            return compact({ ...record, owner: instance, interrupts: record?.interrupts ?? [], runs: [...(record?.runs ?? []).slice(-7), {
              id: input.runId, fingerprint, status: 'running', messages: input.messages, state: input.state ?? record?.runs.at(-1)?.state ?? {},
            }] });
          });
        } catch (error) { claims.delete(claim); releaseClaim(); lease.release(); throw error; }
        for (const failed of instances.values()) failed.delete(local);
        if (input.state === undefined) input.state = claimedPrior?.runs.at(-1)?.state ?? {};
        input.resume = [...supplied.values()].filter(entry => claimedPrior?.interrupts.some(interrupt => interrupt.id === entry.interruptId));
        live.set(local, { cancel: () => controller.abort(), done: finished });
        claims.delete(claim); releaseClaim();
        const events = journal.subscribe(0, request.signal);
        const cancel = () => controller.abort();
        request.signal.addEventListener('abort', cancel, { once: true });
        if (stopping || request.signal.aborted) cancel();
        const timeout = setTimeout(cancel, options.executionTimeoutMs ?? 120000); timeout.unref();
        void (async () => {
          let session: AguiSession | undefined;
          let checkpoint = claimedPrior?.checkpoint;
          let requestedInterrupt: Interrupt[] | undefined;
          let final: RunRecord;
          let terminal: Event | undefined;
          let outputBytes = 0;
          try {
            session = new AguiSession(input, event => {
              outputBytes += Buffer.byteLength(JSON.stringify(event));
              if (outputBytes > (options.maxOutputBytes ?? 1024 * 1024)) throw new Error('Run output limit');
              if (event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR') {
                terminal = protocolSnapshot(event, eventWindowBytes);
              } else journal.publish(event);
            });
            const skippedExecution = controller.signal.aborted;
            const result = skippedExecution ? undefined : await options.execute(input, {
              principal, signal: controller.signal, get checkpoint() { return checkpoint; }, resume: input.resume ?? [],
              get state() { return session!.state; },
              emit: event => session!.emit(event), emitText: delta => session!.text(delta),
              async saveCheckpoint(value) {
                checkpoint = protocolSnapshot(value, 256 * 1024);
                await storage.update<ThreadRecord>(scope, key, record => {
                  if (!record || record.owner !== instance) throw new Error('Lost thread ownership');
                  return { ...record, checkpoint };
                });
              },
              callTool(name, args) {
                if (!input.tools.some(tool => tool.name === name)) throw new Error('Tool is not advertised');
                const id = randomUUID();
                session!.emit({ type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name });
                session!.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(protocolSnapshot(args)) });
                session!.emit({ type: EventType.TOOL_CALL_END, toolCallId: id });
                return id;
              },
              toolResult(id, content) { session!.emit({ type: EventType.TOOL_CALL_RESULT, toolCallId: id, messageId: randomUUID(), content }); },
              interrupt(interrupts, value) {
                requestedInterrupt = interrupts.map(item => InterruptSchema.parse(item));
                if (!requestedInterrupt.length || new Set(requestedInterrupt.map(item => item.id)).size !== requestedInterrupt.length) throw new Error('Interrupt ids must be nonempty and unique');
                if (value !== undefined) checkpoint = protocolSnapshot(value, 256 * 1024);
                return { outcome: { type: 'interrupt', interrupts: requestedInterrupt } };
              },
            });
            const outcome: RunFinishedOutcome = controller.signal.aborted ? { type: 'cancelled' } : requestedInterrupt ? { type: 'interrupt', interrupts: requestedInterrupt } : result?.outcome ?? { type: 'success' };
            if (outcome.type === 'interrupt') {
              outcome.interrupts = outcome.interrupts.map(item => InterruptSchema.parse(item));
              if (!outcome.interrupts.length || new Set(outcome.interrupts.map(item => item.id)).size !== outcome.interrupts.length) throw new Error('Invalid interrupt identities');
            }
            const resultValue = result?.result === undefined ? undefined : protocolSnapshot(result.result, 1024 * 1024);
            // Verify before committing success; buffer the terminal until the durable write succeeds.
            await session.finish(outcome, outcome.type !== 'cancelled' ? resultValue : undefined);
            final = { id: input.runId, fingerprint, status: 'finished', outcome, ...(resultValue !== undefined && outcome.type !== 'cancelled' ? { result: resultValue } : {}), messages: session.messages, state: session.state };
            await storage.update<ThreadRecord>(scope, key, record => {
              if (!record || record.owner !== instance) throw new Error('Lost thread ownership');
              return compact({ ...record, owner: undefined, checkpoint, interrupts: skippedExecution ? record.interrupts : outcome.type === 'interrupt' ? outcome.interrupts : [], runs: record.runs.map(run => run.id === input.runId ? final : run) });
            });
            journal.publish(terminal!);
          } catch {
            instances.get(instance)?.add(local);
            await session?.fail().catch(() => {});
            final = { id: input.runId, fingerprint, status: 'failed', messages: session?.messages ?? input.messages, state: session?.state ?? input.state ?? {} };
            await storage.update<ThreadRecord>(scope, key, record => record ? compact({ ...record, owner: undefined, checkpoint, runs: record.runs.map(run => run.id === input.runId ? final : run) }) : undefined).catch(() => {});
            journal.publish({ type: EventType.RUN_ERROR, message: 'Agent execution failed', code: 'EXECUTION_FAILED' });
          } finally {
            session?.dispose(); clearTimeout(timeout); request.signal.removeEventListener('abort', cancel);
            lease.release(); live.delete(local); journal.finish(); done();
          }
        })();
        const stream = (async function* () {
          try { for await (const event of events) yield encoder.encodeSSE(event); }
          catch { if (!request.signal.aborted) yield encoder.encodeSSE({ type: EventType.RUN_ERROR, message: 'Event history unavailable', code: 'HISTORY_LOST' }); }
          finally { await events.return?.(); if (live.has(local)) { cancel(); await finished; } }
        })();
        const owned: AsyncIterableIterator<string> = {
          [Symbol.asyncIterator]() { return this; }, next: () => stream.next(),
          async return() { cancel(); await events.return?.(); await finished; return stream.return(); },
        };
        return new StreamingResponse(owned, { headers: { ...cors, 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
      } catch (error) { const failure = protocolFailure(error); Object.assign(failure.headers, cors); throw failure; }
    },
  };
}

import { createHash } from 'node:crypto';
import { EventType, type Event } from '@ag-ui/core';
import { textInput } from './input.js';
import { EventEncoder } from '@ag-ui/encoder';
export { createAguiAgent } from './agent.js';
export { EventType } from '@ag-ui/core';
export type { Event, RunAgentInput, Message, Tool, Interrupt, RunFinishedOutcome } from '@ag-ui/core';
export type { AguiAgentOptions, AguiAgentContext, AguiAgentResult } from './agent.js';
import {
  authenticateProtocol,
  protocolFailure,
  protocolOrigins,
  protocolCors,
  ProtocolHttpError,
  Response,
  StreamingResponse,
  requireIdentifier,
  type ProtocolAuthenticator,
  type ProtocolHost,
  type ProtocolRequest,
  type RuntimeProtocol,
  type TextExecutor,
} from '@huaweicloud/agentarts-sdk/sdk/runtime';

export interface AguiAdapterOptions {
  authenticate: ProtocolAuthenticator;
  execute: TextExecutor;
  path?: string;
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  allowedOrigins?: readonly string[];
}
/** AG-UI 1.0 text profile. Connection loss cancels this run; no active-run resume. */
export function createAguiAdapter(options: AguiAdapterOptions): RuntimeProtocol {
  if (typeof options.authenticate !== 'function' || typeof options.execute !== 'function')
    throw new TypeError('authenticate and execute are required');
  const path = options.path ?? '/ag-ui';
  const origins = protocolOrigins(options.allowedOrigins);
  const encoder = new EventEncoder({ accept: 'text/event-stream' });
  return {
    routes: [{ path, methods: ['POST', 'OPTIONS'] }],
    async handle(request: ProtocolRequest, host: ProtocolHost) {
      let cors: Record<string, string> = {};
      try {
        cors = protocolCors(request, origins, ['POST'], ['authorization', 'content-type']);
        if (request.method === 'OPTIONS') return new Response({ statusCode: 204, headers: cors });
        const principal = await authenticateProtocol(request, options.authenticate);
        const raw = await request.json(options.maxBodyBytes, options.bodyTimeoutMs);
        const input = textInput(raw, (message) => host.logger.warn(message));
        requireIdentifier(input.threadId, 'threadId');
        requireIdentifier(input.runId, 'runId');
        const key = createHash('sha256')
          .update(JSON.stringify([path, input.threadId, input.runId]))
          .digest('hex');
        let active = false;
        try {
          active = !host.executions.get(principal, key).outcome;
        } catch (error) {
          if (protocolFailure(error).status !== 404) throw error;
        }
        if (active)
          throw new ProtocolHttpError(409, 'RUN_ALREADY_ACTIVE', 'An active run cannot be resumed');
        // Strip optional undefined defaults produced by schema validation. No wire
        // identity/headers are ever copied into the execution principal.
        const handle = host.executions.start(
          principal,
          key,
          JSON.parse(JSON.stringify(input)),
          options.execute,
        );
        const initialOutput = handle.output;
        const initialOutcome = handle.outcome;
        let events;
        try {
          events = handle.events(handle.sequence, request.signal);
        } catch (error) {
          if (!handle.outcome) void handle.cancel();
          throw error;
        }
        const cancel = () => {
          void handle.cancel();
        };
        request.signal.addEventListener('abort', cancel, { once: true });
        if (request.signal.aborted) cancel();
        const stream = (async function* () {
          let textStarted = false;
          const encode = (event: Event) => encoder.encodeSSE(event);
          try {
            yield encode({
              type: EventType.RUN_STARTED,
              threadId: input.threadId,
              runId: input.runId,
              protocolVersion: '1.0',
            });
            if (initialOutput) {
              textStarted = true;
              yield encode({
                type: EventType.TEXT_MESSAGE_START,
                messageId: handle.executionId,
                role: 'assistant',
              });
              yield encode({
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: handle.executionId,
                delta: initialOutput,
              });
            }
            if (initialOutcome) {
              if (textStarted)
                yield encode({ type: EventType.TEXT_MESSAGE_END, messageId: handle.executionId });
              if (initialOutcome.state === 'failed')
                yield encode({
                  type: EventType.RUN_ERROR,
                  message: 'Agent execution failed',
                  code: 'EXECUTION_FAILED',
                });
              else
                yield encode({
                  type: EventType.RUN_FINISHED,
                  threadId: input.threadId,
                  runId: input.runId,
                  result: initialOutcome.state === 'completed' ? initialOutcome.output : undefined,
                  outcome: { type: initialOutcome.state === 'canceled' ? 'cancelled' : 'success' },
                });
              return;
            }
            for await (const event of events) {
              if (event.type === 'text') {
                if (!textStarted) {
                  textStarted = true;
                  yield encode({
                    type: EventType.TEXT_MESSAGE_START,
                    messageId: handle.executionId,
                    role: 'assistant',
                  });
                }
                yield encode({
                  type: EventType.TEXT_MESSAGE_CONTENT,
                  messageId: handle.executionId,
                  delta: event.delta,
                });
              } else {
                const finalOutcome = await handle.done;
                if (textStarted)
                  yield encode({ type: EventType.TEXT_MESSAGE_END, messageId: handle.executionId });
                if (event.outcome?.state === 'failed')
                  yield encode({
                    type: EventType.RUN_ERROR,
                    message: 'Agent execution failed',
                    code: 'EXECUTION_FAILED',
                  });
                else
                  yield encode({
                    type: EventType.RUN_FINISHED,
                    threadId: input.threadId,
                    runId: input.runId,
                    result: finalOutcome.state === 'completed' ? finalOutcome.output : undefined,
                    outcome: {
                      type: event.outcome?.state === 'canceled' ? 'cancelled' : 'success',
                    },
                  });
              }
            }
          } catch {
            if (!request.signal.aborted) {
              if (textStarted)
                yield encode({ type: EventType.TEXT_MESSAGE_END, messageId: handle.executionId });
              yield encode({
                type: EventType.RUN_ERROR,
                message: 'Event stream unavailable',
                code: 'REPLAY_UNAVAILABLE',
              });
            }
          } finally {
            request.signal.removeEventListener('abort', cancel);
            await events.return?.();
            if (!handle.outcome) await handle.cancel();
          }
        })();
        // Closing before the generator starts must also unsubscribe/cancel.
        const owned = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => stream.next(),
          async return() {
            request.signal.removeEventListener('abort', cancel);
            await events.return?.();
            if (!handle.outcome) await handle.cancel();
            return stream.return();
          },
        };
        return new StreamingResponse(owned, {
          headers: { ...cors, 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
        });
      } catch (error) {
        const failure = protocolFailure(error);
        Object.assign(failure.headers, cors);
        throw failure;
      }
    },
  };
}

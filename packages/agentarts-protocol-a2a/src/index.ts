import { createHash } from 'node:crypto';
import {
  AgentCard,
  Message,
  Task,
  Role,
  TaskState,
  SendMessageRequest,
  ListTasksRequest,
  type StreamResponse,
  type GetTaskRequest,
  type CancelTaskRequest,
} from '@a2a-js/sdk';
import {
  JsonRpcTransportHandler,
  ServerCallContext,
  validateVersion,
  type A2ARequestHandler,
} from '@a2a-js/sdk/server';
import {
  A2AError,
  RequestMalformedError,
  TaskNotFoundError,
  TaskNotCancelableError,
  UnsupportedOperationError,
  PushNotificationNotSupportedError,
  ContentTypeNotSupportedError,
} from '@a2a-js/sdk/errors';
import { taskListing, validateList } from './list.js';
import { fields } from './input.js';
import {
  authenticateProtocol,
  protocolFailure,
  protocolOrigins,
  protocolCors,
  ProtocolHttpError,
  JsonResponse,
  Response,
  StreamingResponse,
  requireIdentifier,
  type ExecutionHandle,
  type ProtocolAuthenticator,
  type ProtocolHost,
  type ProtocolRequest,
  type RuntimeProtocol,
  type TextExecutor,
} from '@huaweicloud/agentarts-sdk/sdk/runtime';

export interface A2aAdapterOptions {
  /** A2A v1.0 protobuf model, e.g. AgentCard.fromJSON(...). The public URL is explicit. */
  agentCard: AgentCard;
  authenticate: ProtocolAuthenticator;
  execute: TextExecutor;
  path?: string;
  cardPath?: string;
  publicAgentCard?: boolean;
  maxBodyBytes?: number;
  bodyTimeoutMs?: number;
  allowedOrigins?: readonly string[];
}

/** Single-process A2A 1.0 JSON-RPC text-task profile using the official transport/codec. */
export function createA2aAdapter(options: A2aAdapterOptions): RuntimeProtocol {
  if (typeof options.authenticate !== 'function' || typeof options.execute !== 'function')
    throw new TypeError('authenticate and execute are required');
  const path = options.path ?? '/a2a';
  const origins = protocolOrigins(options.allowedOrigins);
  const cardPath = options.cardPath ?? '/.well-known/agent-card.json';
  const namespace = `a2a:${createHash('sha256').update(path).digest('hex').slice(0, 16)}:`;
  const card = AgentCard.fromJSON(AgentCard.toJSON(options.agentCard));
  const routingTenant = card.supportedInterfaces[0]?.tenant ?? '';
  if (
    !card.name ||
    !card.supportedInterfaces.length ||
    !card.securityRequirements.length ||
    !Object.keys(card.securitySchemes).length ||
    card.signatures.length ||
    card.capabilities?.extensions.length
  ) {
    throw new TypeError(
      'A2A card requires identity, interfaces and security declarations; signed cards are not supported',
    );
  }
  for (const endpoint of card.supportedInterfaces) {
    const url = new URL(endpoint.url);
    if (
      endpoint.protocolBinding !== 'JSONRPC' ||
      endpoint.protocolVersion !== '1.0' ||
      endpoint.tenant !== routingTenant ||
      url.pathname !== path ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    ) {
      throw new TypeError(
        'Card interfaces must match the mounted A2A 1.0 JSONRPC route (HTTPS except localhost)',
      );
    }
  }
  card.capabilities = {
    streaming: true,
    pushNotifications: false,
    extendedAgentCard: false,
    extensions: [],
  };
  for (const skill of card.skills) {
    skill.inputModes = ['text/plain'];
    skill.outputModes = ['text/plain'];
  }
  card.defaultInputModes = ['text/plain'];
  card.defaultOutputModes = ['text/plain'];
  const unsupported = async (): Promise<never> => {
    throw new UnsupportedOperationError('Operation not supported by the text-task profile');
  };
  const pushUnsupported = async (): Promise<never> => {
    throw new PushNotificationNotSupportedError('Push notifications are not enabled');
  };
  function task(handle: ExecutionHandle, historyLength?: number): Task {
    const input = handle.input as Record<string, unknown>;
    const message = Message.fromJSON(input);
    const contextId = message.contextId || handle.executionId;
    const state = !handle.outcome
      ? TaskState.TASK_STATE_WORKING
      : handle.outcome.state === 'completed'
        ? TaskState.TASK_STATE_COMPLETED
        : handle.outcome.state === 'canceled'
          ? TaskState.TASK_STATE_CANCELED
          : TaskState.TASK_STATE_FAILED;
    return Task.fromJSON({
      id: handle.executionId,
      contextId,
      status: { state, timestamp: new Date(handle.updatedAt).toISOString() },
      history: historyLength === 0 ? [] : [Message.toJSON(message)],
      artifacts: handle.output
        ? [
            {
              artifactId: 'result',
              name: 'result',
              parts: [{ text: handle.output, mediaType: 'text/plain' }],
            },
          ]
        : [],
    });
  }
  const listTasks = taskListing(namespace, task);
  async function wait(handle: ExecutionHandle, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new ProtocolHttpError(408, 'REQUEST_ABORTED', 'Request aborted');
    let abort!: () => void;
    try {
      await Promise.race([
        handle.done,
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(new ProtocolHttpError(408, 'REQUEST_ABORTED', 'Request aborted'));
          signal.addEventListener('abort', abort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener('abort', abort);
    }
  }
  return {
    routes: [
      { path, methods: ['POST', 'OPTIONS'] },
      { path: cardPath, methods: ['GET', 'OPTIONS'] },
    ],
    async handle(request: ProtocolRequest, host: ProtocolHost) {
      let requestId: string | number | null = null;
      let cors: Record<string, string> = {};
      try {
        cors = protocolCors(
          request,
          origins,
          [request.path === cardPath ? 'GET' : 'POST'],
          ['authorization', 'content-type', 'a2a-version'],
        );
        if (request.method === 'OPTIONS') return new Response({ statusCode: 204, headers: cors });
        if (request.path === cardPath) {
          if (!options.publicAgentCard) await authenticateProtocol(request, options.authenticate);
          return new JsonResponse({
            content: AgentCard.toJSON(card),
            headers: { ...cors, 'cache-control': 'no-store', 'a2a-version': '1.0' },
          });
        }
        const principal = await authenticateProtocol(request, options.authenticate);
        const body = await request.json(options.maxBodyBytes, options.bodyTimeoutMs);
        if (!body || typeof body !== 'object' || Array.isArray(body))
          throw new ProtocolHttpError(400, 'INVALID_REQUEST', 'Invalid JSON-RPC request');
        const rpc = body as Record<string, unknown>;
        const id = rpc.id;
        if (
          id === null ||
          typeof id === 'string' ||
          (typeof id === 'number' && Number.isSafeInteger(id))
        )
          requestId = id;
        if (
          rpc.jsonrpc !== '2.0' ||
          !(
            id === null ||
            (typeof id === 'string' && id.length <= 256) ||
            (typeof id === 'number' && Number.isSafeInteger(id))
          ) ||
          typeof rpc.method !== 'string' ||
          rpc.method.length > 64 ||
          rpc.method.length === 0
        ) {
          throw new ProtocolHttpError(400, 'INVALID_REQUEST', 'Invalid JSON-RPC envelope');
        }
        requestId = id;
        if (
          rpc.params !== undefined &&
          (!rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params))
        )
          throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid method parameters');
        const params = fields((rpc.params ?? {}) as Record<string, unknown>, [
          'historyLength',
          'contextId',
          'pageSize',
          'pageToken',
          'statusTimestampAfter',
          'includeArtifacts',
        ]);
        if (params.tenant !== undefined && params.tenant !== routingTenant)
          throw new ProtocolHttpError(403, 'TENANT_MISMATCH', 'Tenant mismatch');
        if (routingTenant && params.tenant !== routingTenant)
          throw new ProtocolHttpError(403, 'TENANT_MISMATCH', 'Routing tenant required');
        delete params.tenant; // Routing is not authentication; never replace the verified principal.
        if (
          params.metadata !== undefined &&
          (!params.metadata ||
            typeof params.metadata !== 'object' ||
            Array.isArray(params.metadata))
        )
          throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid metadata');
        const version = request.headers['a2a-version'];
        try {
          validateVersion(typeof version === 'string' ? version : '0.3', card, 'JSONRPC');
        } catch (error) {
          return new JsonResponse({
            content: {
              jsonrpc: '2.0',
              id,
              error: JsonRpcTransportHandler.mapToJSONRPCError(error),
            },
            headers: { ...cors, 'a2a-version': '1.0' },
          });
        }
        const lookup = (taskId: string) => {
          try {
            const found = host.executions.getById(principal, requireIdentifier(taskId, 'taskId'));
            if (!found.key.startsWith(namespace)) throw new Error('wrong protocol');
            return found;
          } catch {
            throw new TaskNotFoundError('Task not found');
          }
        };
        let prepared: ExecutionHandle | undefined;
        if (rpc.method === 'SendMessage' || rpc.method === 'SendStreamingMessage') {
          if (
            !params.message ||
            typeof params.message !== 'object' ||
            Array.isArray(params.message)
          )
            throw new ProtocolHttpError(400, 'INVALID_MESSAGE', 'Message required');
          const rawMessage = fields(params.message as Record<string, unknown>, [
            'messageId',
            'taskId',
            'contextId',
            'referenceTaskIds',
          ]);
          params.message = rawMessage;
          if (
            !Array.isArray(rawMessage.parts) ||
            rawMessage.parts.some(
              (part) =>
                !part ||
                typeof part !== 'object' ||
                typeof (part as Record<string, unknown>).text !== 'string' ||
                ['url', 'raw', 'data'].some(
                  (key) => (part as Record<string, unknown>)[key] !== undefined,
                ),
            )
          ) {
            throw new ProtocolHttpError(400, 'INVALID_MESSAGE', 'Text parts required');
          }
          requireIdentifier(rawMessage.messageId, 'messageId');
          if (rawMessage.contextId !== undefined)
            requireIdentifier(rawMessage.contextId, 'contextId');
          if (rawMessage.taskId !== undefined && typeof rawMessage.taskId !== 'string')
            throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid taskId');
          for (const name of ['referenceTaskIds', 'extensions']) {
            const value = rawMessage[name];
            if (
              value !== undefined &&
              (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
            )
              throw new ProtocolHttpError(
                400,
                'INVALID_INPUT',
                'Invalid message references or extensions',
              );
          }
          if (
            rawMessage.metadata !== undefined &&
            (!rawMessage.metadata ||
              typeof rawMessage.metadata !== 'object' ||
              Array.isArray(rawMessage.metadata))
          )
            throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid message metadata');
          rawMessage.parts = (rawMessage.parts as Record<string, unknown>[]).map((part) =>
            fields(part, ['mediaType']),
          );
          for (const part of rawMessage.parts as Record<string, unknown>[]) {
            if (
              (part.mediaType !== undefined && typeof part.mediaType !== 'string') ||
              (part.metadata !== undefined &&
                (!part.metadata ||
                  typeof part.metadata !== 'object' ||
                  Array.isArray(part.metadata)))
            )
              throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid text part');
          }
          if (params.configuration !== undefined) {
            let config = params.configuration;
            if (!config || typeof config !== 'object' || Array.isArray(config))
              throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid configuration');
            config = fields(config as Record<string, unknown>, [
              'returnImmediately',
              'acceptedOutputModes',
              'historyLength',
              'taskPushNotificationConfig',
            ]);
            params.configuration = config;
            const values = config as Record<string, unknown>;
            if (
              (values.returnImmediately !== undefined &&
                typeof values.returnImmediately !== 'boolean') ||
              (values.acceptedOutputModes !== undefined &&
                (!Array.isArray(values.acceptedOutputModes) ||
                  values.acceptedOutputModes.some((mode) => typeof mode !== 'string'))) ||
              (values.historyLength !== undefined &&
                (!Number.isSafeInteger(values.historyLength) ||
                  (values.historyLength as number) < 0))
            ) {
              throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid configuration');
            }
          }
          const typed = SendMessageRequest.fromJSON(params);
          const message = typed.message;
          if (typed.configuration?.taskPushNotificationConfig)
            throw new ProtocolHttpError(
              400,
              'PUSH_NOT_SUPPORTED',
              'Push notifications are not enabled',
            );
          if (message?.taskId)
            throw new ProtocolHttpError(
              400,
              'UNSUPPORTED_OPERATION',
              'Existing task continuation is not supported',
            );
          if (
            message?.parts.some(
              (part) =>
                part.mediaType &&
                part.mediaType.split(';')[0]!.trim().toLowerCase() !== 'text/plain',
            ) ||
            (typed.configuration?.acceptedOutputModes.length &&
              !typed.configuration.acceptedOutputModes.includes('text/plain'))
          )
            throw new ProtocolHttpError(
              400,
              'CONTENT_TYPE_NOT_SUPPORTED',
              'Only text/plain is supported',
            );
          if (
            !message ||
            message.role !== Role.ROLE_USER ||
            !message.parts.length ||
            message.parts.length > 128 ||
            message.parts.some(
              (part) =>
                part.content?.$case !== 'text' ||
                part.content.value.length > 65536 ||
                (part.mediaType &&
                  part.mediaType.split(';')[0]!.trim().toLowerCase() !== 'text/plain'),
            ) ||
            (typed.configuration?.historyLength !== undefined &&
              (!Number.isSafeInteger(typed.configuration.historyLength) ||
                typed.configuration.historyLength < 0))
          ) {
            throw new ProtocolHttpError(
              400,
              'UNSUPPORTED_CAPABILITY',
              'Only new user text tasks are supported',
            );
          }
          const key = namespace + createHash('sha256').update(message.messageId).digest('hex');
          prepared = host.executions.start(
            principal,
            key,
            Message.toJSON(message),
            options.execute,
          );
        }
        if (['GetTask', 'CancelTask', 'SubscribeToTask', 'ListTasks'].includes(rpc.method)) {
          if (rpc.method !== 'ListTasks') requireIdentifier(params.id, 'taskId');
          if (
            params.historyLength !== undefined &&
            (!Number.isSafeInteger(params.historyLength) || (params.historyLength as number) < 0)
          ) {
            throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid historyLength');
          }
        }
        let listed;
        if (rpc.method === 'ListTasks') {
          validateList(params);
          listed = listTasks(host.executions, principal, ListTasksRequest.fromJSON(params));
        }
        const streamHandle =
          rpc.method === 'SendStreamingMessage'
            ? prepared
            : rpc.method === 'SubscribeToTask'
              ? lookup(String(params.id))
              : undefined;
        if (rpc.method === 'SubscribeToTask' && streamHandle?.outcome)
          throw new UnsupportedOperationError('Cannot subscribe to a terminal task');
        // Reserve the subscription BEFORE returning the HTTP stream. Initial task
        // snapshot + future events avoids duplicating artifacts during resubscribe.
        const historyLength =
          rpc.method === 'SendStreamingMessage'
            ? SendMessageRequest.fromJSON(params).configuration?.historyLength
            : undefined;
        const initial = streamHandle ? task(streamHandle, historyLength) : undefined;
        const events = streamHandle
          ? streamHandle.events(streamHandle.sequence, request.signal)
          : undefined;
        const streamTask = async function* (): AsyncGenerator<StreamResponse> {
          if (!streamHandle || !initial || !events)
            throw new RequestMalformedError('No task stream');
          try {
            yield { payload: { $case: 'task', value: initial } };
            if (initial.status?.state !== TaskState.TASK_STATE_WORKING) return;
            let append = initial.artifacts.length > 0;
            for await (const event of events) {
              if (event.type === 'text') {
                const value = Task.fromJSON({
                  artifacts: [
                    {
                      artifactId: 'result',
                      parts: [{ text: event.delta, mediaType: 'text/plain' }],
                    },
                  ],
                }).artifacts[0]!;
                yield {
                  payload: {
                    $case: 'artifactUpdate',
                    value: {
                      taskId: initial.id,
                      contextId: initial.contextId,
                      artifact: value,
                      append,
                      lastChunk: false,
                      metadata: undefined,
                    },
                  },
                };
                append = true;
              } else {
                const final = task(streamHandle);
                if (final.artifacts.length)
                  yield {
                    payload: {
                      $case: 'artifactUpdate',
                      value: {
                        taskId: final.id,
                        contextId: final.contextId,
                        artifact: final.artifacts[0],
                        append: false,
                        lastChunk: true,
                        metadata: undefined,
                      },
                    },
                  };
                yield {
                  payload: {
                    $case: 'statusUpdate',
                    value: {
                      taskId: final.id,
                      contextId: final.contextId,
                      status: final.status,
                      metadata: undefined,
                    },
                  },
                };
              }
            }
          } finally {
            await events.return?.();
          }
        };
        const handler: A2ARequestHandler = {
          getAgentCard: async () => card,
          getAuthenticatedExtendedAgentCard: unsupported,
          async sendMessage(typed) {
            if (!prepared) throw new RequestMalformedError('No task');
            const reservation = prepared.events(prepared.sequence, request.signal);
            try {
              if (!typed.configuration?.returnImmediately) await wait(prepared, request.signal);
              return task(prepared, typed.configuration?.historyLength);
            } finally {
              await reservation.return?.();
            }
          },
          sendMessageStream: streamTask,
          async getTask(typed: GetTaskRequest) {
            return task(lookup(typed.id), typed.historyLength);
          },
          async cancelTask(typed: CancelTaskRequest) {
            const handle = lookup(typed.id);
            if (handle.outcome) throw new TaskNotCancelableError('Task already finished');
            void handle.cancel();
            await wait(handle, request.signal);
            return task(handle);
          },
          resubscribe: streamTask,
          listTasks: async () => listed!,
          createTaskPushNotificationConfig: pushUnsupported,
          getTaskPushNotificationConfig: pushUnsupported,
          listTaskPushNotificationConfigs: pushUnsupported,
          deleteTaskPushNotificationConfig: pushUnsupported,
        };
        const context = new ServerCallContext({
          requestedVersion: '1.0',
          tenant: routingTenant,
          user: { isAuthenticated: true, userName: principal.subject },
        });
        const transport = new JsonRpcTransportHandler(handler);
        const result = await transport.handle({ ...rpc, params }, context);
        const headers = { ...cors, 'cache-control': 'no-store', 'a2a-version': '1.0' };
        if (!(Symbol.asyncIterator in result)) {
          await events?.return?.();
          return new JsonResponse({ content: result, headers });
        }
        const iterator = result;
        const frames = (async function* () {
          try {
            for await (const frame of iterator) yield `data: ${JSON.stringify(frame)}\n\n`;
          } catch {
            if (!request.signal.aborted)
              yield `data: ${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Task event stream unavailable' } })}\n\n`;
          } finally {
            await events?.return?.();
          }
        })();
        const owned: AsyncIterableIterator<string> = {
          [Symbol.asyncIterator]() {
            return this;
          },
          next: () => frames.next(),
          async return() {
            await events?.return?.();
            await iterator.return();
            return frames.return();
          },
        };
        return new StreamingResponse(owned, { headers: { ...headers, 'x-accel-buffering': 'no' } });
      } catch (error) {
        if (error instanceof A2AError)
          return new JsonResponse({
            content: {
              jsonrpc: '2.0',
              id: requestId,
              error: JsonRpcTransportHandler.mapToJSONRPCError(error),
            },
            headers: { ...cors, 'a2a-version': '1.0' },
          });
        const failure = protocolFailure(error);
        if (request.path !== cardPath && ![401, 403, 408, 413, 415].includes(failure.status)) {
          const semantic =
            failure.code === 'PUSH_NOT_SUPPORTED'
              ? new PushNotificationNotSupportedError(failure.message)
              : failure.code === 'UNSUPPORTED_OPERATION'
                ? new UnsupportedOperationError(failure.message)
                : failure.code === 'CONTENT_TYPE_NOT_SUPPORTED'
                  ? new ContentTypeNotSupportedError(failure.message)
                  : undefined;
          const code =
            failure.code === 'INVALID_JSON'
              ? -32700
              : failure.code === 'INVALID_REQUEST'
                ? -32600
                : failure.status === 400
                  ? -32602
                  : failure.status === 500
                    ? -32603
                    : -32000;
          return new JsonResponse({
            statusCode: failure.status,
            content: {
              jsonrpc: '2.0',
              id: code === -32700 ? null : requestId,
              error: semantic
                ? JsonRpcTransportHandler.mapToJSONRPCError(semantic)
                : { code, message: failure.message },
            },
            headers: { ...cors, 'cache-control': 'no-store', 'a2a-version': '1.0' },
          });
        }
        Object.assign(failure.headers, cors);
        throw failure;
      }
    },
  };
}

export { AgentCard } from '@a2a-js/sdk';
export { createA2aService } from './service.js';
export type { A2aServiceOptions, A2aService } from './service.js';
export type { A2aAgentContext, A2aAgentResult, A2aEngineOptions } from './engine.js';
export { TaskState, Role, Task, Message, Artifact, Part } from '@a2a-js/sdk';
export { generateAgentCardSignature, verifyAgentCardSignature } from '@a2a-js/sdk';

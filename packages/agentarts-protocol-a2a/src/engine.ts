import { taskFromJSON, messageFromJSON, artifactFromJSON, streamFromJSON } from './wire.js';
import { createHash, randomUUID } from 'node:crypto';
import { AgentCard, Artifact, Message, Role, StreamResponse, Task, TaskState, TaskPushNotificationConfig,
  type SendMessageRequest, type GetTaskRequest, ListTasksRequest, type CancelTaskRequest,
  type SubscribeToTaskRequest, type GetExtendedAgentCardRequest, type GetTaskPushNotificationConfigRequest,
  type ListTaskPushNotificationConfigsRequest, type DeleteTaskPushNotificationConfigRequest, type ListTasksResponse, type ListTaskPushNotificationConfigsResponse,
} from '@a2a-js/sdk';
import { A2AError, TaskNotFoundError, TaskNotCancelableError, UnsupportedOperationError, RequestMalformedError, PushNotificationNotSupportedError, ExtensionSupportRequiredError, ContentTypeNotSupportedError } from '@a2a-js/sdk/errors';
import type { A2ARequestHandler, ServerCallContext } from '@a2a-js/sdk/server';
import { AgentArtsRuntimeApp, MemoryProtocolStorage, ProtocolEventJournal, protocolSnapshot, requireIdentifier,
  protocolFingerprint, boundedInteger, type ProtocolStorage, type ExecutionPrincipal } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { taskListing, validateList } from './list.js';

export interface A2aAgentResult { state?: TaskState; artifacts?: Artifact[]; checkpoint?: unknown }
export interface A2aAgentContext {
  readonly task: Task; readonly principal: ExecutionPrincipal; readonly signal: AbortSignal; readonly checkpoint: unknown;
  readonly extensions: readonly string[];
  emitArtifact(artifact: Artifact, append?: boolean): Promise<void>;
  setStatus(state: TaskState, message?: Message): void;
  saveCheckpoint(value: unknown): Promise<void>;
}
export interface A2aEngineOptions {
  runtime: AgentArtsRuntimeApp;
  agentCard: AgentCard;
  authenticateScope: (context: ServerCallContext) => ExecutionPrincipal;
  execute: (message: Message, context: A2aAgentContext) => string | void | A2aAgentResult | Promise<string | void | A2aAgentResult>;
  storage?: ProtocolStorage;
  namespace?: string;
  maxTasksPerPrincipal?: number;
  executionTimeoutMs?: number;
  push?: {
    validate(config: TaskPushNotificationConfig): Promise<void>;
    send(config: TaskPushNotificationConfig, event: StreamResponse): Promise<void>;
  };
  extendedAgentCard?: (principal: ExecutionPrincipal) => Promise<AgentCard>;
  signCard?: (card: AgentCard) => Promise<AgentCard>;
}
interface TaskRecord { task: unknown; owner?: string; checkpoint?: unknown; configs: unknown[]; requests: string[] }
interface Flow { controller: AbortController; journal: ProtocolEventJournal<unknown>; done: Promise<void>; task: Task; failed?: boolean }
const flows = new Map<string, Flow>();
const owners = new Map<string, Set<string>>();
const orphaned = (owner: string, key: string) => !owners.has(owner) || owners.get(owner)!.has(key);
const gates = new Map<string, Promise<unknown>>();
async function gate<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = gates.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation); gates.set(key, next);
  try { return await next; } finally { if (gates.get(key) === next) gates.delete(key); }
}
const terminal = (state: TaskState | undefined) => [TaskState.TASK_STATE_COMPLETED, TaskState.TASK_STATE_FAILED, TaskState.TASK_STATE_CANCELED, TaskState.TASK_STATE_REJECTED].includes(state!);
const pauses = (state: TaskState | undefined) => [TaskState.TASK_STATE_INPUT_REQUIRED, TaskState.TASK_STATE_AUTH_REQUIRED].includes(state!);
function supports(mode: string, allowed: readonly string[]): boolean {
  return allowed.some(value => value === '*/*' || value === mode || (value.endsWith('/*') && mode.startsWith(value.slice(0, -1))));
}
function validateParts(parts: Artifact['parts'], modes: readonly string[]) {
  if (!parts.length || parts.length > 128) throw new RequestMalformedError('Invalid content parts');
  for (const part of parts) {
    if (!part.content || !['text', 'raw', 'url', 'data'].includes(part.content.$case)) throw new RequestMalformedError('Invalid part content');
    const arm = part.content.$case;
    if ((arm === 'text' || arm === 'url') && typeof part.content.value !== 'string') throw new RequestMalformedError('Invalid part value');
    if (arm === 'raw' && !(part.content.value instanceof Uint8Array)) throw new RequestMalformedError('Invalid binary part');
    const mode = part.mediaType || (arm === 'text' ? 'text/plain' : arm === 'data' ? 'application/json' : 'application/octet-stream');
    if (!supports(mode, modes)) throw new ContentTypeNotSupportedError('Unsupported content type');
  }
}

function upsertPushConfig(configs: readonly unknown[], config: TaskPushNotificationConfig): unknown[] {
  const remaining = configs.filter(raw => TaskPushNotificationConfig.fromJSON(raw).id !== config.id);
  if (remaining.length >= 16) throw new RequestMalformedError('Push config capacity');
  return [...remaining, TaskPushNotificationConfig.toJSON(config)];
}

export class A2aAgentEngine implements A2ARequestHandler {
  private readonly storage: ProtocolStorage;
  private readonly namespace: string;
  private readonly instance = randomUUID();
  private readonly tasks = new Set<Flow>();
  private stopping = false;
  private readonly claims = new Set<Promise<void>>();
  private readonly listing;
  constructor(private readonly options: A2aEngineOptions) {
    boundedInteger(options.executionTimeoutMs ?? 120000, 'executionTimeoutMs', 2147483647);
    boundedInteger(options.maxTasksPerPrincipal ?? 64, 'maxTasksPerPrincipal');
    this.storage = options.storage ?? new MemoryProtocolStorage();
    this.namespace = options.namespace ?? 'a2a:agent';
    owners.set(this.instance, new Set());
    this.listing = taskListing(this.namespace, (handle: { executionId: string; key: string; updatedAt: number; input: unknown }) => taskFromJSON(handle.input));
  }
  private scope(context: ServerCallContext): { scope: string; principal: ExecutionPrincipal } {
    const principal = this.options.authenticateScope(context);
    requireIdentifier(principal.tenantId, 'tenantId'); requireIdentifier(principal.subject, 'subject');
    return { principal, scope: createHash('sha256').update(JSON.stringify([this.namespace, principal.tenantId, principal.subject])).digest('hex') };
  }
  private async notifyPush(configs: readonly unknown[], event: StreamResponse) {
    const push = this.options.push;
    if (!push) return;
    await Promise.all(configs.map(raw =>
      push.send(TaskPushNotificationConfig.fromJSON(raw), event)
        .catch(() => this.options.runtime.logger.warning('A2A webhook delivery failed')),
    ));
  }
  private key(scope: string, id: string) { return `${scope}:${id}`; }
  private async record(scope: string, id: string): Promise<TaskRecord> {
    requireIdentifier(id, 'taskId');
    let record = await this.storage.get<TaskRecord>(scope, `task:${id}`);
    if (!record) throw new TaskNotFoundError('Task not found');
    if (record.owner && orphaned(record.owner, this.key(scope, id))) {
      record = (await this.storage.update<TaskRecord>(scope, `task:${id}`, current => {
        if (!current) throw new TaskNotFoundError('Task not found');
        if (!current.owner || !orphaned(current.owner, this.key(scope, id))) return current;
        const task = taskFromJSON(current.task);
        task.status = { state: TaskState.TASK_STATE_INPUT_REQUIRED, timestamp: new Date().toISOString(), message: messageFromJSON({ messageId: randomUUID(), role: 'ROLE_AGENT', contextId: task.contextId, taskId: task.id, parts: [{ text: 'Execution was interrupted. Send a follow-up message to resume from the saved checkpoint.' }] }) };
        return { ...current, owner: undefined, task: Task.toJSON(task) };
      }))!;
      for (const failed of owners.values()) failed.delete(this.key(scope, id));
    }
    return record;
  }
  async getAgentCard(): Promise<AgentCard> {
    const card = AgentCard.fromJSON(AgentCard.toJSON(this.options.agentCard));
    try { return this.options.signCard ? await this.options.signCard(card) : card; }
    catch { throw new A2AError('Agent card signing failed'); }
  }
  async getAuthenticatedExtendedAgentCard(_params: GetExtendedAgentCardRequest, context: ServerCallContext): Promise<AgentCard> {
    if (!this.options.extendedAgentCard) throw new UnsupportedOperationError('Extended agent card is not configured');
    try {
      const card = await this.options.extendedAgentCard(this.scope(context).principal);
      return this.options.signCard ? await this.options.signCard(card) : card;
    } catch { throw new A2AError('Extended agent card unavailable'); }
  }
  private validateMessage(message: Message | undefined) {
    if (!message || message.role !== Role.ROLE_USER || !message.parts.length || message.parts.length > 128) throw new RequestMalformedError('User message parts required');
    requireIdentifier(message.messageId, 'messageId');
    if (message.contextId) requireIdentifier(message.contextId, 'contextId');
    for (const part of message.parts) {
      if (!part.content || !['text', 'raw', 'url', 'data'].includes(part.content.$case)) throw new RequestMalformedError('Exactly one part content is required');
      if (Buffer.byteLength(JSON.stringify(Message.toJSON(message))) > 512 * 1024) throw new RequestMalformedError('Message size limit');
    }
  }
  private async prepare(params: SendMessageRequest, context: ServerCallContext): Promise<{ task: Task; flow?: Flow }> {
    const decoded = context.state.get('agentarts:message') ? messageFromJSON(context.state.get('agentarts:message')) : params.message;
    this.validateMessage(decoded);
    validateParts(decoded!.parts, this.options.agentCard.defaultInputModes);
    const outputModes = params.configuration?.acceptedOutputModes?.length ? params.configuration.acceptedOutputModes : this.options.agentCard.defaultOutputModes;
    if (!outputModes.some(mode => this.options.agentCard.defaultOutputModes.some(own => supports(own, [mode]) || supports(mode, [own])))) throw new ContentTypeNotSupportedError('No supported output mode');
    if (this.stopping) throw new UnsupportedOperationError('Agent is shutting down');
    const { scope, principal } = this.scope(context);
    const message = messageFromJSON(Message.toJSON(decoded!));
    const requested = context.requestedExtensions ?? [];
    const declared = this.options.agentCard.capabilities?.extensions ?? [];
    if (declared.some(extension => extension.required && !requested.includes(extension.uri))) throw new ExtensionSupportRequiredError('Required extension was not requested');
    const extensions = requested.filter(uri => declared.some(extension => extension.uri === uri));
    for (const uri of extensions) context.addActivatedExtension(uri);
    const hash = protocolFingerprint(Message.toJSON(message));
    return gate(`${scope}:prepare`, async () => {
      const dedupeKey = `message:${createHash('sha256').update(message.messageId).digest('hex')}`;
      const duplicate = await this.storage.get<{ hash: string; taskId: string }>(scope, dedupeKey);
      if (duplicate) {
        if (duplicate.hash !== hash) throw new RequestMalformedError('Message id reused with different content');
        const accepted = await this.storage.get<TaskRecord>(scope, `task:${duplicate.taskId}`);
        if (accepted?.requests?.includes(message.messageId))
          return { task: taskFromJSON((await this.record(scope, duplicate.taskId)).task), flow: flows.get(this.key(scope, duplicate.taskId)) };
      }
      let record: TaskRecord | undefined;
      if (message.taskId) {
        record = await this.record(scope, message.taskId);
        const task = taskFromJSON(record.task);
        if (terminal(task.status?.state)) throw new UnsupportedOperationError('Terminal tasks cannot be continued');
        if (flows.has(this.key(scope, task.id)) || (record.owner && owners.has(record.owner)))
          throw new UnsupportedOperationError('Previous task execution is still closing');
        if (message.contextId && message.contextId !== task.contextId) throw new RequestMalformedError('Task/context mismatch');
        message.contextId = task.contextId;
      } else {
        const count = (await this.storage.list<TaskRecord>(scope)).filter(entry => entry.key.startsWith('task:')).length;
        if (count >= (this.options.maxTasksPerPrincipal ?? 64)) throw new UnsupportedOperationError('Task capacity reached');
        message.taskId = duplicate?.taskId ?? randomUUID(); message.contextId ||= randomUUID();
      }
      if (params.configuration?.taskPushNotificationConfig && !this.options.push) throw new PushNotificationNotSupportedError('Push delivery is not configured');
      if (params.configuration?.taskPushNotificationConfig) await this.options.push!.validate(params.configuration.taskPushNotificationConfig);
      if (this.stopping) throw new UnsupportedOperationError('Agent is shutting down');
      const lease = this.options.runtime.acquireSlot();
      if ((record?.requests.length ?? 0) >= 1024) { lease.release(); throw new RequestMalformedError('Conversation request limit'); }
      const task = record ? taskFromJSON(record.task) : taskFromJSON({ id: message.taskId, contextId: message.contextId, history: [], artifacts: [] });
      task.history = [...task.history, message];
      while (task.history.length > 1 && Buffer.byteLength(JSON.stringify(task.history.map(Message.toJSON))) > 512 * 1024) task.history.shift();
      task.status = { state: TaskState.TASK_STATE_WORKING, timestamp: new Date().toISOString(), message: undefined };
      const requestedConfig = params.configuration?.taskPushNotificationConfig;
      const pushConfig = requestedConfig
        ? { ...requestedConfig, taskId: task.id, id: requestedConfig.id || randomUUID() }
        : undefined;
      let checkpoint = record?.checkpoint;
      const previousArtifacts = new Set(task.artifacts);
      let durableArtifacts = [...task.artifacts];
      let releaseClaim!: () => void;
      const claim = new Promise<void>(resolve => { releaseClaim = resolve; });
      this.claims.add(claim);
      try {
        await this.storage.update(scope, dedupeKey, () => ({ hash, taskId: task.id }));
        await this.storage.update<TaskRecord>(scope, `task:${task.id}`, current => {
          const configs = current?.configs ?? [];
          return {
            task: Task.toJSON(task),
            owner: this.instance,
            configs: pushConfig ? upsertPushConfig(configs, pushConfig) : configs,
            checkpoint,
            requests: [...(current?.requests ?? []), message.messageId],
          };
        });
      } catch (error) {
        if (!duplicate) await this.storage.update(scope, dedupeKey, () => undefined).catch(() => {});
        this.claims.delete(claim); releaseClaim();
        lease.release(); throw error;
      }
      const controller = new AbortController();
      const journal = new ProtocolEventJournal<unknown>(256, 2 * 1024 * 1024);
      let finish!: () => void;
      const flow: Flow = { controller, journal, done: new Promise(resolve => { finish = resolve; }), task };
      flows.set(this.key(scope, task.id), flow); this.tasks.add(flow);
      if (this.stopping) controller.abort();
      this.claims.delete(claim); releaseClaim();
      let pendingStatus: { state: TaskState; message?: Message } | undefined;
      let outputBytes = 0;
      let emission = Promise.resolve();
      const publish = async (event: StreamResponse, broadcast = true, charge = true) => {
        const json = StreamResponse.toJSON(event);
        if (charge) { outputBytes += Buffer.byteLength(JSON.stringify(json)); if (outputBytes > 2 * 1024 * 1024) throw new Error('Task output limit'); }
        if (broadcast) journal.publish(json);
        const current = this.options.push ? await this.storage.get<TaskRecord>(scope, `task:${task.id}`) : undefined;
        await this.notifyPush(current?.configs ?? [], event);
      };
      const persist = async () => {
        await this.storage.update<TaskRecord>(scope, `task:${task.id}`, current => {
          if (!current || current.owner !== this.instance) throw new Error('Lost task ownership');
          return { ...current, task: Task.toJSON(task), checkpoint };
        });
        durableArtifacts = [...task.artifacts];
      };
      const timer = setTimeout(() => controller.abort(), this.options.executionTimeoutMs ?? 120000); timer.unref();
      // Start after the caller can reserve its subscription. Execution is not driven by readers.
      queueMicrotask(() => { void (async () => {
        try {
          if (!controller.signal.aborted) await publish(streamFromJSON({ task: Task.toJSON(task) }), false, false);
          if (controller.signal.aborted) throw new Error('Task cancelled before execution');
          const result = await this.options.execute(message, {
            get task() { return taskFromJSON(Task.toJSON(task)); }, principal, signal: controller.signal, extensions,
            get checkpoint() { return checkpoint; },
            emitArtifact: (artifact, append = false) => {
              const snapshot = artifactFromJSON(Artifact.toJSON(artifact));
              const operation = emission.then(async () => {
                if (controller.signal.aborted || pendingStatus) throw new Error('Task no longer accepts output');
                requireIdentifier(snapshot.artifactId, 'artifactId');
                validateParts(snapshot.parts, outputModes);
                if (!snapshot.parts.length || snapshot.parts.some(part => !part.content) || Buffer.byteLength(JSON.stringify(Artifact.toJSON(snapshot))) > 512 * 1024) throw new Error('Invalid artifact');
                const existing = task.artifacts.findIndex(item => item.artifactId === snapshot.artifactId);
                if (existing >= 0) task.artifacts[existing] = append ? { ...snapshot, parts: [...task.artifacts[existing]!.parts, ...snapshot.parts] } : snapshot;
                else task.artifacts.push(snapshot);
                if (task.artifacts.some(item => item.parts.length > 128)) throw new Error('Artifact parts capacity');
                if (Buffer.byteLength(JSON.stringify(task.artifacts.map(Artifact.toJSON))) > 1024 * 1024) throw new Error('Artifact capacity');
                await persist();
                await publish(streamFromJSON({ artifactUpdate: { taskId: task.id, contextId: task.contextId, artifact: Artifact.toJSON(snapshot), append, lastChunk: false } }));
              });
              emission = operation; void operation.catch(() => {}); return operation;
            },
            setStatus(state, statusMessage) {
              if (!terminal(state) && !pauses(state)) throw new Error('Result state must be terminal or waiting');
              let snapshot: Message | undefined;
              if (statusMessage) {
                snapshot = messageFromJSON(Message.toJSON(statusMessage));
                requireIdentifier(snapshot.messageId, 'messageId');
                if (snapshot.role !== Role.ROLE_AGENT || (snapshot.taskId && snapshot.taskId !== task.id) || (snapshot.contextId && snapshot.contextId !== task.contextId) || Buffer.byteLength(JSON.stringify(Message.toJSON(snapshot))) > 512 * 1024) throw new Error('Invalid status message');
                validateParts(snapshot.parts, outputModes);
                snapshot.taskId = task.id; snapshot.contextId = task.contextId;
              }
              pendingStatus = { state, ...(snapshot ? { message: snapshot } : {}) };
            },
            async saveCheckpoint(value) { checkpoint = protocolSnapshot(value, 256 * 1024); await persist(); },
          });
          await emission;
          if (typeof result === 'string') {
            const artifact = artifactFromJSON({ artifactId: randomUUID(), parts: [{ text: result, mediaType: 'text/plain' }] });
            validateParts(artifact.parts, outputModes);
            task.artifacts.push(artifact);
          }
          else if (result) {
            if (result.checkpoint !== undefined) checkpoint = protocolSnapshot(result.checkpoint, 256 * 1024);
            for (const artifact of result.artifacts ?? []) {
              const snapshot = artifactFromJSON(Artifact.toJSON(artifact));
              requireIdentifier(snapshot.artifactId, 'artifactId');
              validateParts(snapshot.parts, outputModes);
              const index = task.artifacts.findIndex(item => item.artifactId === snapshot.artifactId);
              if (index < 0) task.artifacts.push(snapshot); else task.artifacts[index] = snapshot;
            }
            if (result.state !== undefined) pendingStatus = { state: result.state };
          }
          const state = controller.signal.aborted ? TaskState.TASK_STATE_CANCELED : pendingStatus?.state ?? TaskState.TASK_STATE_COMPLETED;
          if (!terminal(state) && !pauses(state)) throw new Error('Invalid final task state');
          if (task.artifacts.some(artifact => artifact.parts.length > 128)) throw new Error('Artifact parts capacity');
          if (Buffer.byteLength(JSON.stringify(task.artifacts.map(Artifact.toJSON))) > 1024 * 1024) throw new Error('Artifact capacity');
          task.status = { state, timestamp: new Date().toISOString(), message: pendingStatus?.message };
        } catch {
          task.artifacts = durableArtifacts;
          task.status = { state: controller.signal.aborted ? TaskState.TASK_STATE_CANCELED : TaskState.TASK_STATE_FAILED, timestamp: new Date().toISOString(), message: undefined };
        } finally {
          try {
            await this.storage.update<TaskRecord>(scope, `task:${task.id}`, current => {
              if (!current || current.owner !== this.instance) throw new Error('Lost task ownership');
              return { ...current, task: Task.toJSON(task), checkpoint, owner: undefined };
            });
            // Final artifact snapshots include return values and close streamed artifacts.
            for (const artifact of task.artifacts) if (!previousArtifacts.has(artifact)) await publish(streamFromJSON({ artifactUpdate: { taskId: task.id, contextId: task.contextId, artifact: Artifact.toJSON(artifact), append: false, lastChunk: true } }), true, false);
            await publish(streamFromJSON({ statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status } }), true, false);
          } catch { flow.failed = true; owners.get(this.instance)?.add(this.key(scope, task.id)); this.options.runtime.logger.warning('A2A task persistence/delivery failed'); }
          clearTimeout(timer); lease.release(); journal.finish();
          const key = this.key(scope, task.id);
          if (flows.get(key) === flow) flows.delete(key);
          this.tasks.delete(flow); finish();
        }
      })(); });
      return { task, flow };
    });
  }
  async sendMessage(params: SendMessageRequest, context: ServerCallContext): Promise<Task> {
    const { task, flow } = await this.prepare(params, context);
    if (flow && !params.configuration?.returnImmediately) await flow.done;
    if (flow?.failed) throw new A2AError('Task result could not be persisted');
    return this.getTask({ tenant: params.tenant, id: task.id, historyLength: params.configuration?.historyLength }, context);
  }
  async *sendMessageStream(params: SendMessageRequest, context: ServerCallContext): AsyncGenerator<StreamResponse> {
    const { task, flow } = await this.prepare(params, context);
    const first = streamFromJSON({ task: Task.toJSON(task) });
    const events = flow?.journal.subscribe(flow.journal.sequence);
    yield first;
    if (!events) return;
    try { for await (const event of events) yield streamFromJSON(event); if (flow?.failed) throw new A2AError('Task result unavailable'); } finally { await events.return?.(); }
  }
  async getTask(params: GetTaskRequest, context: ServerCallContext): Promise<Task> {
    const { scope } = this.scope(context);
    const task = taskFromJSON((await this.record(scope, params.id)).task);
    if (params.historyLength !== undefined) {
      if (!Number.isSafeInteger(params.historyLength) || params.historyLength < 0) throw new RequestMalformedError('Invalid historyLength');
      task.history = params.historyLength ? task.history.slice(-params.historyLength) : [];
    }
    return task;
  }
  async listTasks(params: ListTasksRequest, context: ServerCallContext): Promise<ListTasksResponse> {
    validateList(ListTasksRequest.toJSON(params) as Record<string, unknown>);
    const { scope, principal } = this.scope(context);
    const handles: Array<{ executionId: string; key: string; updatedAt: number; input: unknown }> = [];
    for (const entry of await this.storage.list<TaskRecord>(scope)) if (entry.key.startsWith('task:')) {
      const task = taskFromJSON((await this.record(scope, entry.key.slice(5))).task);
      if (params.historyLength !== undefined) task.history = params.historyLength ? task.history.slice(-params.historyLength) : [];
      handles.push({ executionId: task.id, key: this.namespace, updatedAt: Date.parse(task.status?.timestamp ?? ''), input: Task.toJSON(task) });
    }
    return this.listing({ list: () => handles }, principal, params);
  }
  async cancelTask(params: CancelTaskRequest, context: ServerCallContext): Promise<Task> {
    const { scope } = this.scope(context);
    const outcome = await gate(`${scope}:prepare`, async () => {
      const record = await this.record(scope, params.id);
      const task = taskFromJSON(record.task);
      if (terminal(task.status?.state)) throw new TaskNotCancelableError('Task already terminal');
      const flow = flows.get(this.key(scope, task.id));
      if (flow && record.owner) {
        flow.controller.abort();
        return { flow };
      }
      // A paused task may still be delivering the previous run's final events.
      await flow?.done;
      const canceled = await this.storage.update<TaskRecord>(scope, `task:${task.id}`, current => {
        if (!current) throw new TaskNotFoundError('Task not found');
        const latest = taskFromJSON(current.task);
        if (terminal(latest.status?.state) || current.owner) throw new TaskNotCancelableError('Task is no longer cancelable');
        latest.status = { state: TaskState.TASK_STATE_CANCELED, timestamp: new Date().toISOString(), message: undefined };
        return { ...current, task: Task.toJSON(latest) };
      });
      return { canceled: canceled! };
    });
    if (outcome.flow) {
      await outcome.flow.done;
      if (outcome.flow.failed) throw new A2AError('Task result could not be persisted');
      return this.getTask({ tenant: params.tenant, id: params.id }, context);
    }
    const task = taskFromJSON(outcome.canceled.task);
    await this.notifyPush(outcome.canceled.configs, streamFromJSON({
      statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status },
    }));
    return task;
  }
  async *resubscribe(params: SubscribeToTaskRequest, context: ServerCallContext): AsyncGenerator<StreamResponse> {
    const { scope } = this.scope(context);
    const task = await this.getTask(params, context);
    if (terminal(task.status?.state)) throw new UnsupportedOperationError('Cannot subscribe to a terminal task');
    const flow = flows.get(this.key(scope, task.id));
    const events = flow?.journal.subscribe(flow.journal.sequence);
    yield streamFromJSON({ task: Task.toJSON(task) });
    if (events) try { for await (const event of events) yield streamFromJSON(event); if (flow?.failed) throw new A2AError('Task result unavailable'); } finally { await events.return?.(); }
  }
  async createTaskPushNotificationConfig(config: TaskPushNotificationConfig, context: ServerCallContext): Promise<TaskPushNotificationConfig> {
    if (!this.options.push) throw new PushNotificationNotSupportedError('Push delivery is not configured');
    const { scope } = this.scope(context); await this.record(scope, config.taskId);
    await this.options.push.validate(config); config.id ||= randomUUID();
    await this.storage.update<TaskRecord>(scope, `task:${config.taskId}`, record => {
      if (!record) throw new TaskNotFoundError('Task not found');
      return { ...record, configs: upsertPushConfig(record.configs, config) };
    }); return config;
  }
  async getTaskPushNotificationConfig(params: GetTaskPushNotificationConfigRequest, context: ServerCallContext): Promise<TaskPushNotificationConfig> {
    if (!this.options.push) throw new PushNotificationNotSupportedError('Push delivery is not configured');
    const { scope } = this.scope(context); const record = await this.record(scope, params.taskId);
    const config = record.configs.map(TaskPushNotificationConfig.fromJSON).find(config => config.id === params.id);
    if (!config) throw new TaskNotFoundError('Push config not found'); return config;
  }
  async listTaskPushNotificationConfigs(params: ListTaskPushNotificationConfigsRequest, context: ServerCallContext): Promise<ListTaskPushNotificationConfigsResponse> {
    if (!this.options.push) throw new PushNotificationNotSupportedError('Push delivery is not configured');
    const { scope } = this.scope(context); const record = await this.record(scope, params.taskId);
    // The reference REST binding currently drops these query parameters.
    params = { ...params, ...(context.state.get('agentarts:push-page') as { pageSize?: number; pageToken?: string } | undefined) };
    const size = params.pageSize || 16;
    if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new RequestMalformedError('Invalid page size');
    const configs = record.configs.map(TaskPushNotificationConfig.fromJSON).sort((a, b) => a.id.localeCompare(b.id));
    // Cursor is a config identity in this authenticated task, never an index into another scope.
    const start = params.pageToken ? configs.findIndex(config => config.id === params.pageToken) + 1 : 0;
    if (params.pageToken && !start) throw new RequestMalformedError('Invalid page token');
    const page = configs.slice(start, start + size);
    return { configs: page, nextPageToken: start + size < configs.length ? page.at(-1)!.id : '' };
  }
  async deleteTaskPushNotificationConfig(params: DeleteTaskPushNotificationConfigRequest, context: ServerCallContext) {
    if (!this.options.push) throw new PushNotificationNotSupportedError('Push delivery is not configured');
    const { scope } = this.scope(context); await this.record(scope, params.taskId);
    await this.storage.update<TaskRecord>(scope, `task:${params.taskId}`, record => {
      if (!record || !record.configs.some(raw => TaskPushNotificationConfig.fromJSON(raw).id === params.id)) throw new TaskNotFoundError('Push config not found');
      return { ...record, configs: record.configs.filter(raw => TaskPushNotificationConfig.fromJSON(raw).id !== params.id) };
    });
  }
  async shutdown() {
    this.stopping = true;
    await Promise.all(this.claims);
    const running = [...this.tasks]; for (const flow of running) flow.controller.abort();
    await Promise.all(running.map(flow => flow.done)); owners.delete(this.instance);
  }
}

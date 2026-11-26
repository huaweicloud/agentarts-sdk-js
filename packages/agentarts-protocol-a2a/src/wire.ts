import { Artifact, Message, Task, StreamResponse } from '@a2a-js/sdk';
import { ProtocolHttpError, requireIdentifier } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { fields } from './input.js';
import { validateList } from './list.js';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => { throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid A2A parameters'); };
function metadata(value: unknown) { if (value !== undefined && value !== null && !object(value)) invalid(); }
export function normalizeSend(raw: Record<string, unknown>): Record<string, unknown> {
  const params = fields(raw, []);
  if (!object(params.message)) invalid();
  const message = fields(params.message as Record<string, unknown>, ['messageId', 'contextId', 'taskId', 'referenceTaskIds']);
  requireIdentifier(message.messageId, 'messageId');
  for (const field of ['contextId', 'taskId']) if (message[field] !== undefined && message[field] !== '') requireIdentifier(message[field], field);
  if (!['ROLE_USER', 1].includes(message.role as string | number)) invalid();
  metadata(message.metadata); metadata(params.metadata);
  for (const field of ['referenceTaskIds', 'extensions']) {
    const value = message[field];
    if (value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) invalid();
  }
  if (!Array.isArray(message.parts) || !message.parts.length || message.parts.length > 128) invalid();
  message.parts = (message.parts as unknown[]).map(value => {
    if (!object(value)) invalid();
    const part = fields(value as Record<string, unknown>, ['mediaType']);
    const arms = ['text', 'raw', 'url', 'data'].filter(key => Object.hasOwn(part, key));
    if (arms.length !== 1) invalid();
    const arm = arms[0]!;
    if (arm !== 'data' && typeof part[arm] !== 'string') invalid();
    if (arm === 'raw' && (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(part.raw as string) || (part.raw as string).replace(/=/g, '').length % 4 === 1)) invalid();
    if ((part.mediaType !== undefined && typeof part.mediaType !== 'string') || (part.filename !== undefined && typeof part.filename !== 'string')) invalid();
    metadata(part.metadata); return part;
  });
  params.message = message;
  if (params.configuration !== undefined) {
    if (!object(params.configuration)) invalid();
    const config = fields(params.configuration as Record<string, unknown>, ['returnImmediately', 'acceptedOutputModes', 'historyLength', 'taskPushNotificationConfig']);
    if ((config.returnImmediately !== undefined && typeof config.returnImmediately !== 'boolean') ||
        (config.historyLength !== undefined && (!Number.isSafeInteger(config.historyLength) || Number(config.historyLength) < 0)) ||
        (config.acceptedOutputModes !== undefined && (!Array.isArray(config.acceptedOutputModes) || config.acceptedOutputModes.some(item => typeof item !== 'string')))) invalid();
    if (config.taskPushNotificationConfig !== undefined && config.taskPushNotificationConfig !== null) config.taskPushNotificationConfig = normalizePush(config.taskPushNotificationConfig);
    params.configuration = config;
  }
  return params;
}
export function normalizePush(raw: unknown): Record<string, unknown> {
  if (!object(raw)) invalid();
  const config = fields(raw as Record<string, unknown>, ['taskId']);
  if (config.taskId !== undefined && config.taskId !== '') requireIdentifier(config.taskId, 'taskId');
  if (config.id !== undefined && config.id !== '') requireIdentifier(config.id, 'id');
  if (typeof config.url !== 'string' || (config.token !== undefined && typeof config.token !== 'string')) invalid();
  if (config.authentication !== undefined) {
    if (!object(config.authentication) || typeof config.authentication.scheme !== 'string' || typeof config.authentication.credentials !== 'string') invalid();
  }
  return config;
}
export function normalizeRpc(raw: unknown): Record<string, unknown> {
  if (!object(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string' || !raw.method.length || raw.method.length > 64 ||
      !(raw.id === null || (typeof raw.id === 'string' && raw.id.length <= 256) || (typeof raw.id === 'number' && Number.isSafeInteger(raw.id))))
    throw new ProtocolHttpError(400, 'INVALID_REQUEST', 'Invalid JSON-RPC envelope');
  if (raw.params !== undefined && !object(raw.params)) invalid();
  let params = fields((raw.params ?? {}) as Record<string, unknown>, ['taskId', 'historyLength', 'contextId', 'pageSize', 'pageToken', 'includeArtifacts', 'statusTimestampAfter']);
  if (['SendMessage', 'SendStreamingMessage'].includes(raw.method as string)) params = normalizeSend(params);
  if (['GetTask', 'CancelTask', 'SubscribeToTask'].includes(raw.method as string)) requireIdentifier(params.id, 'taskId');
  if (params.historyLength !== undefined && (!Number.isSafeInteger(params.historyLength) || Number(params.historyLength) < 0)) invalid();
  if (raw.method === 'ListTasks') validateList(params);
  if (raw.method === 'CreateTaskPushNotificationConfig') params = normalizePush(params);
  if (['CreateTaskPushNotificationConfig', 'GetTaskPushNotificationConfig', 'DeleteTaskPushNotificationConfig', 'ListTaskPushNotificationConfigs'].includes(raw.method as string)) requireIdentifier(params.taskId, 'taskId');
  if (['GetTaskPushNotificationConfig', 'DeleteTaskPushNotificationConfig'].includes(raw.method as string)) requireIdentifier(params.id, 'id');
  if (raw.method === 'ListTaskPushNotificationConfigs' && ((params.pageSize !== undefined && (!Number.isSafeInteger(params.pageSize) || Number(params.pageSize) < 0 || Number(params.pageSize) > 100)) || (params.pageToken !== undefined && typeof params.pageToken !== 'string'))) invalid();
  if (params.tenant !== undefined && typeof params.tenant !== 'string') invalid();
  metadata(params.metadata);
  return { ...raw, params };
}

// The reference SDK drops a data:null oneof in fromJSON. Preserve its presence
// at our boundary, through persistence and across the three transport bindings.
export function messageFromJSON(raw: any): Message {
  const message = Message.fromJSON(raw);
  for (let i = 0; i < (raw?.parts?.length ?? 0); i++) if (Object.hasOwn(raw.parts[i], 'data') && raw.parts[i].data === null && message.parts[i]) message.parts[i]!.content = { $case: 'data', value: null };
  return message;
}
export function artifactFromJSON(raw: any): Artifact {
  const artifact = Artifact.fromJSON(raw);
  artifact.parts = messageFromJSON({ parts: raw?.parts ?? [] }).parts; return artifact;
}
export function taskFromJSON(raw: any): Task {
  const task = Task.fromJSON(raw);
  if (task.status && raw?.status?.message) task.status.message = messageFromJSON(raw.status.message);
  task.history = (raw?.history ?? []).map(messageFromJSON);
  task.artifacts = (raw?.artifacts ?? []).map(artifactFromJSON); return task;
}
export function streamFromJSON(raw: any): StreamResponse {
  const event = StreamResponse.fromJSON(raw);
  if (event.payload?.$case === 'task') event.payload.value = taskFromJSON(raw.task);
  if (event.payload?.$case === 'message') event.payload.value = messageFromJSON(raw.message);
  if (event.payload?.$case === 'statusUpdate' && raw.statusUpdate?.status?.message) event.payload.value.status!.message = messageFromJSON(raw.statusUpdate.status.message);
  if (event.payload?.$case === 'artifactUpdate' && raw.artifactUpdate?.artifact) event.payload.value.artifact = artifactFromJSON(raw.artifactUpdate.artifact);
  return event;
}

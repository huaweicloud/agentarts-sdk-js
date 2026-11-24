/** Memory data-plane operations: SDK conversion, result wrapping and client lifecycle. */
import {
  MemoryClient,
  MemorySearchFilter,
  MemoryListFilter,
  TextMessage,
  ToolCallMessage,
  ToolResultMessage,
} from '../../../sdk/memory/index.js';
import type {
  ClientMessage,
  ClientAddMessagesOptions,
  JsonDict,
} from '../../../sdk/memory/index.js';
import { MemoryDataResult } from './models.js';
import type { SpaceOperationOptions } from './space.js';

export interface MemoryDataOptions extends SpaceOperationOptions {
  /** Optional explicit API Key; otherwise the SDK reads the environment. */
  apiKey?: string | null;
}

async function execute<T>(
  options: MemoryDataOptions,
  run: (client: MemoryClient) => Promise<T>,
): Promise<MemoryDataResult<T>> {
  let client: MemoryClient | undefined;
  const result = new MemoryDataResult<T>({ success: false });
  try {
    client = new MemoryClient({
      regionName: options.region,
      apiKey: options.apiKey,
      verifySsl: !options.skipSslVerification,
    });
    result.data = await run(client);
    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (error) {
        result.success = false;
        const message = `Failed to close Memory client: ${String(error)}`;
        result.error = result.error ? `${result.error}; ${message}` : message;
      }
    }
  }
  return result;
}

/** Message JSON uses SDK fields: type, role/content or tool-specific fields. */
function convertMessages(messages: unknown): ClientMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Messages must be a non-empty array.');
  }
  return messages.map((message): ClientMessage => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new Error('Each message must be a JSON object.');
    }
    for (const key of ['id', 'name', 'toolCallId', 'actorId', 'assistantId', 'meta', 'content']) {
      if (message[key] !== undefined && message[key] !== null && typeof message[key] !== 'string')
        throw new Error(`Message ${key} must be a string.`);
    }
    switch (message.type ?? 'text') {
      case 'text': {
        if (
          !['user', 'assistant', 'system'].includes(message.role ?? 'user') ||
          typeof message.content !== 'string' ||
          !message.content
        ) {
          throw new Error('Text messages require content and a user, assistant or system role.');
        }
        return new TextMessage(message);
      }
      case 'tool_call':
        if (!message.id || !message.name) throw new Error('Tool calls require id and name.');
        return new ToolCallMessage(message);
      case 'tool_result':
        if (!message.toolCallId) throw new Error('Tool results require toolCallId.');
        return new ToolResultMessage(message);
      default:
        throw new Error(`Unsupported message type: ${message.type}`);
    }
  });
}

export function createMemorySession(
  spaceId: string,
  id?: string,
  actorId?: string,
  assistantId?: string,
  meta?: JsonDict,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) =>
    client.createMemorySession(spaceId, id, actorId, assistantId, meta),
  );
}
export function listSessions(
  spaceId: string,
  actorId?: string,
  limit = 20,
  offset = 0,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => client.listSessions(spaceId, actorId, limit, offset));
}
export function getSession(spaceId: string, sessionId: string, options: MemoryDataOptions = {}) {
  return execute(options, (client) => client.getSession(spaceId, sessionId));
}
export function deleteSession(spaceId: string, sessionId: string, options: MemoryDataOptions = {}) {
  return execute(options, (client) => client.deleteSession(spaceId, sessionId));
}
export function addMessages(
  spaceId: string,
  sessionId: string,
  messages: unknown,
  writeOptions: ClientAddMessagesOptions = {},
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) =>
    client.addMessages(spaceId, sessionId, convertMessages(messages), writeOptions),
  );
}
export function listMessages(
  spaceId: string,
  sessionId?: string,
  limit = 10,
  offset = 0,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => client.listMessages(spaceId, sessionId, limit, offset));
}
export function getMessage(
  messageId: string,
  spaceId: string,
  sessionId: string,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => client.getMessage(messageId, spaceId, sessionId));
}
export function getLastKMessages(
  sessionId: string,
  k: number,
  spaceId: string,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => client.getLastKMessages(sessionId, k, spaceId));
}
/** These keys follow the SDK filter models' fromDict() wire format. */
function validateFilters(filters: JsonDict, search: boolean): void {
  const strings = [
    'strategy_type',
    'strategy_id',
    'actor_id',
    'assistant_id',
    'session_id',
    ...(search ? ['query', 'memory_type'] : ['sort_by', 'sort_order']),
  ];
  const numbers = ['start_time', 'end_time', ...(search ? ['top_k', 'min_score'] : [])];
  const booleans = search ? ['only_actived', 'rerank'] : [];
  for (const [key, value] of Object.entries(filters)) {
    if (![...strings, ...numbers, ...booleans].includes(key))
      throw new Error(`Unknown SDK filter field: ${key} (use snake_case fields).`);
    if (value === null || value === undefined) continue;
    const kind = strings.includes(key) ? 'string' : numbers.includes(key) ? 'number' : 'boolean';
    if (typeof value !== kind || (kind === 'number' && !Number.isFinite(value)))
      throw new Error(`Filter ${key} must be ${kind}.`);
  }
  const enums: Record<string, string[]> = {
    memory_type: ['memory', 'episode', 'reflection'],
    sort_by: ['created_at', 'updated_at'],
    sort_order: ['asc', 'desc'],
  };
  for (const [key, values] of Object.entries(enums)) {
    if (filters[key] != null && !values.includes(filters[key]))
      throw new Error(`Filter ${key} must be one of ${values.join(', ')}.`);
  }
}

export function searchMemories(
  spaceId: string,
  filters?: JsonDict,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => {
    if (filters !== undefined) validateFilters(filters, true);
    return client.searchMemories(
      spaceId,
      filters === undefined ? undefined : MemorySearchFilter.fromDict(filters),
    );
  });
}
export function listMemories(
  spaceId: string,
  limit = 10,
  offset = 0,
  filters?: JsonDict,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => {
    if (filters !== undefined) validateFilters(filters, false);
    return client.listMemories(
      spaceId,
      limit,
      offset,
      filters === undefined ? undefined : MemoryListFilter.fromDict(filters),
    );
  });
}
export function getMemory(spaceId: string, memoryId: string, options: MemoryDataOptions = {}) {
  return execute(options, (client) => client.getMemory(spaceId, memoryId));
}
export function deleteMemory(spaceId: string, memoryId: string, options: MemoryDataOptions = {}) {
  return execute(options, (client) => client.deleteMemory(spaceId, memoryId));
}

/** Direct record writes accept the same OpenAPI body as MemoryClient. */
export function createMemory(spaceId: string, request: JsonDict, options: MemoryDataOptions = {}) {
  return execute(options, (client) => client.createMemory(spaceId, request));
}
export function updateMemory(
  spaceId: string,
  memoryId: string,
  request: JsonDict,
  options: MemoryDataOptions = {},
) {
  return execute(options, (client) => client.updateMemory(spaceId, memoryId, request));
}

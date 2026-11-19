/**
 * Agent Memory SDK - Data Plane.
 *
 * Data plane: handles messages, memories and other operations, based on the
 * Huawei Cloud backend API definitions.
 *
 * Mirrors `agentarts/sdk/memory/inner/dataplane.py`. `_AsyncDataPlane`
 * (see `dataplane-async.ts`) shares this implementation with an async HTTP
 * client, exactly like the Python async module duplicates the sync one.
 */

import { getLogger } from '../../utils/logging.js';
import { MemoryHttpService } from '../../service/memory-service.js';

import {
  CreateMemoryRequest,
  MemoryInfo,
  MemoryListFilter,
  MemoryListResponse,
  MemorySearchFilter,
  MemorySearchResponse,
  MemoryUpdateRequest,
  MessageBatchResponse,
  MessageInfo,
  MessageListResponse,
  SessionCreateRequest,
  SessionInfo,
  SessionListResponse,
} from './config.js';
import type { JsonDict } from './config.js';

const logger = getLogger('sdk.memory.inner.dataplane');

/** Message data class. */
export class Message {
  /** `user` or `assistant`. */
  role = '';
  content = '';

  constructor(init?: Partial<Message>) {
    Object.assign(this, init ?? {});
  }

  toDict(): JsonDict {
    return { role: this.role, content: this.content };
  }

  static fromDict(dict?: JsonDict | null): Message {
    const data = dict ?? {};
    return new Message({ role: data['role'], content: data['content'] });
  }
}

/** Options accepted by {@link _DataPlane} / `_AsyncDataPlane`. */
export interface DataPlaneOptions {
  /** Huawei Cloud region name, auto-detected from the environment if omitted. */
  regionName?: string | null;
  /** API Key for data plane authentication (falls back to the environment). */
  apiKey?: string | null;
  /**
   * SSL verification setting: `true` (default), `false` to skip verification,
   * or a path to a custom CA certificate file.
   */
  verifySsl?: boolean | string;
  /** Custom endpoint URL (development/testing). */
  endpoint?: string | null;
}

/**
 * Data Plane API - based on the Huawei Cloud backend API implementation.
 *
 * @typeParam C HTTP client type; `_AsyncDataPlane` specializes it with
 *   `AsyncMemoryHttpService`.
 */
export class _DataPlane<C extends MemoryHttpService = MemoryHttpService> {
  client: C;

  constructor(options: DataPlaneOptions = {}) {
    this.client = this._createHttpClient(options);
    logger.info(`${this._getLogName()} initialized`);
  }

  /** Name used in lifecycle log messages. */
  protected _getLogName(): string {
    return 'DataPlane';
  }

  /** Create the HTTP client used by this data plane. */
  protected _createHttpClient(options: DataPlaneOptions): C {
    return new MemoryHttpService({
      regionName: options.regionName,
      endpointType: 'data',
      apiKey: options.apiKey,
      verifySsl: options.verifySsl ?? true,
      endpoint: options.endpoint,
    }) as C;
  }

  /** Create a Memory Session. */
  async createMemorySession(
    spaceId: string,
    request: SessionCreateRequest,
  ): Promise<SessionInfo> {
    logger.info(`Creating memory session in space: ${spaceId}`);

    const result = await this.client.createSession(spaceId, request.toDict());

    logger.info(`Memory session created: ${result?.['id']}`);
    return SessionInfo.fromDict(result);
  }

  /** List sessions in a space. */
  async listSessions(
    spaceId: string,
    actorId?: string | null,
    limit = 20,
    offset = 0,
  ): Promise<SessionListResponse> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }

    logger.info(`Listing sessions in space: ${spaceId}`);
    const result = await this.client.listSessions(spaceId, actorId, limit, offset);
    logger.info(`Sessions retrieved: ${(result?.['items'] ?? []).length} sessions`);
    return SessionListResponse.fromDict(result);
  }

  /** Delete a session (soft delete). */
  async deleteSession(spaceId: string, sessionId: string): Promise<void> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }
    if (!sessionId) {
      throw new Error('session_id is required for delete operation');
    }

    await this.client.deleteSession(spaceId, sessionId);
    logger.info(`Session deleted: ${sessionId} in space: ${spaceId}`);
  }

  /** Get session details. */
  async getSession(spaceId: string, sessionId: string): Promise<SessionInfo> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }
    if (!sessionId) {
      throw new Error('session_id is required for get_session');
    }

    const result = await this.client.getSession(spaceId, sessionId);
    logger.info(`Session retrieved: ${sessionId} in space: ${spaceId}`);
    return SessionInfo.fromDict(result);
  }

  /**
   * Add messages.
   *
   * @param spaceId Space ID (required).
   * @param sessionId Session ID.
   * @param messages Messages already converted to the OpenAPI format.
   * @param timestamp Client API call time (milliseconds timestamp, optional).
   * @param idempotencyKey Idempotency key for batch operations.
   * @param isForceExtract Whether to force trigger memory extraction.
   */
  async addMessages(
    spaceId: string,
    sessionId: string,
    messages: JsonDict[],
    timestamp?: number | null,
    idempotencyKey?: string | null,
    isForceExtract = false,
  ): Promise<MessageBatchResponse> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }

    logger.info(`Adding ${messages.length} messages to session: ${sessionId}`);

    const requestData: JsonDict = {
      messages,
      is_force_extract: isForceExtract,
    };
    if (timestamp !== undefined && timestamp !== null) {
      requestData['timestamp'] = timestamp;
    }
    if (idempotencyKey !== undefined && idempotencyKey !== null) {
      requestData['idempotency_key'] = idempotencyKey;
    }

    const result = await this.client.addMessages(spaceId, sessionId, requestData);
    logger.info(`Messages added to session: ${sessionId}`);
    return MessageBatchResponse.fromDict(result);
  }

  /** Get the last K messages of a session. */
  async getLastKMessages(sessionId: string, k: number, spaceId: string): Promise<MessageInfo[]> {
    if (!spaceId) {
      throw new Error('space_id is required');
    }

    logger.info(`Getting last ${k} messages from session: ${sessionId}`);

    const first = await this.client.listMessages(spaceId, sessionId, 1, 0);
    const total: number = first?.['total'] ?? 0;

    const offset = Math.max(0, total - k);

    const result = await this.client.listMessages(spaceId, sessionId, k, offset);
    return ((result?.['items'] ?? []) as JsonDict[]).map((message) =>
      MessageInfo.fromDict(message),
    );
  }

  /** Get a single message. */
  async getMessage(messageId: string, spaceId: string, sessionId: string): Promise<MessageInfo> {
    logger.info(`Getting message: ${messageId}`);
    const result = await this.client.getMessage(spaceId, sessionId, messageId);
    return MessageInfo.fromDict(result);
  }

  /** List messages. */
  async listMessages(
    spaceId: string,
    sessionId?: string | null,
    limit = 10,
    offset = 0,
  ): Promise<MessageListResponse> {
    logger.info(`Listing messages in space: ${spaceId}, session: ${sessionId}`);
    const result = await this.client.listMessages(spaceId, sessionId, limit, offset);
    return MessageListResponse.fromDict(result);
  }

  /** Create a long-term memory record through the existing HTTP service. */
  async createMemory(
    spaceId: string,
    request: CreateMemoryRequest | JsonDict,
  ): Promise<MemoryInfo> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }

    const data = typeof request.toDict === 'function' ? request.toDict() : request;
    const result = await this.client.createMemory(spaceId, data);
    return MemoryInfo.fromDict(result);
  }

  /** Update a long-term memory record through the existing HTTP service. */
  async updateMemory(
    spaceId: string,
    memoryId: string,
    request: MemoryUpdateRequest | JsonDict,
  ): Promise<MemoryInfo> {
    if (!spaceId) {
      throw new Error('space_id is required for data plane operations');
    }
    if (!memoryId) {
      throw new Error('memory_id is required for update operation');
    }

    const data = typeof request.toDict === 'function' ? request.toDict() : request;
    const result = await this.client.updateMemory(spaceId, memoryId, data);
    return MemoryInfo.fromDict(result);
  }

  /** Search memories. */
  async searchMemories(
    spaceId: string,
    filters?: MemorySearchFilter | null,
  ): Promise<MemorySearchResponse> {
    logger.info(`Searching memories in space: ${spaceId}`);

    const filtersDict = filters ? filters.toDict() : {};
    const result = await this.client.searchMemories(spaceId, filtersDict);
    return MemorySearchResponse.fromDict(result);
  }

  /** List memory records. */
  async listMemories(
    spaceId: string,
    limit = 10,
    offset = 0,
    filters?: MemoryListFilter | null,
  ): Promise<MemoryListResponse> {
    logger.info(`Listing memories in space: ${spaceId}`);
    const filtersDict = filters ? filters.toDict() : {};
    const result = await this.client.listMemories(spaceId, limit, offset, filtersDict);
    return MemoryListResponse.fromDict(result);
  }

  /** Get a memory record. */
  async getMemory(spaceId: string, memoryId: string): Promise<MemoryInfo> {
    logger.info(`Getting memory: ${memoryId}`);
    const result = await this.client.getMemory(spaceId, memoryId);
    return MemoryInfo.fromDict(result);
  }

  /** Delete a memory record. */
  async deleteMemory(spaceId: string, memoryId: string): Promise<void> {
    logger.info(`Deleting memory: ${memoryId}`);
    await this.client.deleteMemory(spaceId, memoryId);
  }

  /** Close the data plane and release resources. */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      logger.info(`${this._getLogName()} closed`);
    }
  }
}

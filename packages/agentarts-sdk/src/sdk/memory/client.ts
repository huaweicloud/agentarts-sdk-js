/**
 * Agent Memory SDK - MemoryClient.
 *
 * Main entry class providing all public methods.
 *
 * Mirrors `agentarts/sdk/memory/client.py`:
 * - Control plane (Space management) uses AK/SK authentication, initialized
 *   lazily on first use.
 * - Data plane (sessions, messages, memories) uses API Key authentication.
 *
 * All methods are asynchronous (PORTING.md §4); `AsyncMemoryClient` provides the
 * same API on top of `_AsyncDataPlane`.
 */

import { getRegion } from '../utils/constant.js';

import {
  CreateMemoryRequest,
  describeType,
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
  SpaceCreateRequest,
  SpaceInfo,
  SpaceListResponse,
  SpaceUpdateRequest,
  TextMessage,
  ToolCallMessage,
  ToolResultMessage,
} from './inner/config.js';
import type { JsonDict } from './inner/config.js';
import { _ControlPlane } from './inner/controlplane.js';
import { _DataPlane } from './inner/dataplane.js';
import type { DataPlaneOptions } from './inner/dataplane.js';

/** Options accepted by {@link MemoryClient} / `AsyncMemoryClient`. */
export interface MemoryClientOptions {
  /** Huawei Cloud region name, auto-detected from the environment if omitted. */
  regionName?: string | null;
  /** API Key for data plane authentication (falls back to the environment). */
  apiKey?: string | null;
  /**
   * SSL verification setting: `true` (default), `false` to skip verification,
   * or a path to a custom CA certificate file.
   */
  verifySsl?: boolean | string;
}

/** Options of `createSpace` (Python keyword arguments). */
export interface CreateSpaceOptions {
  /** Message retention time in hours (default 168, range 1-8760). */
  messageTtlHours?: number;
  description?: string | null;
  tags?: Array<Record<string, string>> | null;
  memoryExtractIdleSeconds?: number | null;
  memoryExtractMaxTokens?: number | null;
  memoryExtractMaxMessages?: number | null;
  /** Enable public network access (default true). */
  publicAccessEnable?: boolean;
  privateVpcId?: string | null;
  privateSubnetId?: string | null;
  memoryStrategiesBuiltin?: string[] | null;
  memoryStrategiesCustomized?: JsonDict[] | null;
}

/** Options of `updateSpace` (Python keyword arguments). */
export interface UpdateSpaceOptions {
  name?: string | null;
  description?: string | null;
  messageTtlHours?: number | null;
  memoryExtractEnabled?: boolean | null;
  memoryExtractIdleSeconds?: number | null;
  memoryExtractMaxTokens?: number | null;
  memoryExtractMaxMessages?: number | null;
  tags?: Array<Record<string, string>> | null;
  memoryStrategiesBuiltin?: string[] | null;
}

/** Keyword-only options of `addMessages` (Python `*` parameters). */
export interface ClientAddMessagesOptions {
  /** Client API call time (milliseconds timestamp). */
  timestamp?: number | null;
  /** Idempotency key preventing duplicate writes on retry. */
  idempotencyKey?: string | null;
  /** Whether to force trigger memory extraction. */
  isForceExtract?: boolean;
}

/** Supported message types for `addMessages`. */
export type ClientMessage = TextMessage | ToolCallMessage | ToolResultMessage;

/** Drop `undefined`/`null` entries so data-class defaults keep applying. */
function definedOnly<T extends Record<string, any>>(source: T): Partial<T> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

/**
 * Memory Client - main entry class.
 *
 * Provides complete Memory service capabilities, including Space management,
 * Session management, and message/memory CRUD operations.
 *
 * @typeParam C Data plane type; `AsyncMemoryClient` specializes it with
 *   `_AsyncDataPlane`.
 */
export class MemoryClient<C extends _DataPlane = _DataPlane> {
  /** Region used by this client. */
  regionName: string;

  protected _verifySsl: boolean | string;
  /** Control plane (lazily initialized; `null` until the first Space call). */
  protected _controlPlane: _ControlPlane | null;
  protected _dataPlane: C;
  protected _controlPlaneInit?: Promise<_ControlPlane>;

  /**
   * @param first Options object, or the region name when using the positional
   *   form (same order as the Python signature).
   * @param apiKey API Key for data plane authentication (positional form only).
   * @param verifySsl SSL verification setting (positional form only).
   */
  constructor(
    first?: MemoryClientOptions | string | null,
    apiKey?: string | null,
    verifySsl: boolean | string = true,
  ) {
    const options: MemoryClientOptions =
      typeof first === 'object' && first !== null
        ? first
        : { regionName: first ?? undefined, apiKey: apiKey ?? undefined, verifySsl };

    this.regionName = options.regionName || getRegion();
    this._verifySsl = options.verifySsl ?? true;

    this._controlPlane = null;
    this._dataPlane = this._createDataPlane({
      regionName: options.regionName,
      apiKey: options.apiKey,
      verifySsl: this._verifySsl,
    });
  }

  /** Create the data plane used by this client. */
  protected _createDataPlane(options: DataPlaneOptions): C {
    return new _DataPlane(options) as C;
  }

  /** The data plane used by this client. */
  get dataPlane(): C {
    return this._dataPlane;
  }

  /** The lazily initialized control plane (`null` before the first Space call). */
  get controlPlane(): _ControlPlane | null {
    return this._controlPlane;
  }

  /**
   * Ensure the control plane is initialized (lazy loading).
   *
   * Concurrent callers share a single initialization, mirroring Python's
   * `threading.Lock` protection.
   */
  protected async _ensureControlPlaneInitialized(regionName: string): Promise<_ControlPlane> {
    if (!this._controlPlaneInit) {
      this._controlPlaneInit = (async () => {
        const controlPlane = new _ControlPlane({
          regionName,
          verifySsl: this._verifySsl,
        });
        this._controlPlane = controlPlane;
        return controlPlane;
      })().catch((error: unknown) => {
        // Allow a later call to retry initialization.
        this._controlPlaneInit = undefined;
        throw error;
      });
    }
    return this._controlPlaneInit;
  }

  // ==================== Control Plane - Space Management ====================

  /**
   * Create a Space.
   *
   * @param name Space name (1-128 characters).
   * @param options Space configuration (message TTL, tags, network access...).
   * @returns The created Space, including the generated API Key.
   */
  async createSpace(name: string, options?: CreateSpaceOptions): Promise<SpaceInfo>;
  async createSpace(
    name: string,
    messageTtlHours?: number,
    description?: string | null,
    tags?: Array<Record<string, string>> | null,
    memoryExtractIdleSeconds?: number | null,
    memoryExtractMaxTokens?: number | null,
    memoryExtractMaxMessages?: number | null,
    publicAccessEnable?: boolean,
    privateVpcId?: string | null,
    privateSubnetId?: string | null,
    memoryStrategiesBuiltin?: string[] | null,
    memoryStrategiesCustomized?: JsonDict[] | null,
  ): Promise<SpaceInfo>;
  async createSpace(name: string, ...args: any[]): Promise<SpaceInfo> {
    const options: CreateSpaceOptions =
      args.length > 0 && typeof args[0] === 'object' && args[0] !== null
        ? (args[0] as CreateSpaceOptions)
        : definedOnly({
            messageTtlHours: args[0],
            description: args[1],
            tags: args[2],
            memoryExtractIdleSeconds: args[3],
            memoryExtractMaxTokens: args[4],
            memoryExtractMaxMessages: args[5],
            publicAccessEnable: args[6],
            privateVpcId: args[7],
            privateSubnetId: args[8],
            memoryStrategiesBuiltin: args[9],
            memoryStrategiesCustomized: args[10],
          });

    const request = new SpaceCreateRequest({ name, ...definedOnly(options) });

    const controlPlane = await this._ensureControlPlaneInitialized(this.regionName);

    return controlPlane.createSpace(request);
  }

  /** Get Space details. */
  async getSpace(spaceId: string): Promise<SpaceInfo> {
    const controlPlane = await this._ensureControlPlaneInitialized(this.regionName);
    return controlPlane.getSpace(spaceId);
  }

  /** List Spaces. */
  async listSpaces(limit = 20, offset = 0): Promise<SpaceListResponse> {
    const controlPlane = await this._ensureControlPlaneInitialized(this.regionName);
    return controlPlane.listSpaces(limit, offset);
  }

  /**
   * Update Space configuration (partial update).
   *
   * @param spaceId Space ID.
   * @param options Fields to update.
   */
  async updateSpace(spaceId: string, options?: UpdateSpaceOptions): Promise<SpaceInfo>;
  async updateSpace(
    spaceId: string,
    name?: string | null,
    description?: string | null,
    messageTtlHours?: number | null,
    memoryExtractEnabled?: boolean | null,
    memoryExtractIdleSeconds?: number | null,
    memoryExtractMaxTokens?: number | null,
    memoryExtractMaxMessages?: number | null,
    tags?: Array<Record<string, string>> | null,
    memoryStrategiesBuiltin?: string[] | null,
  ): Promise<SpaceInfo>;
  async updateSpace(spaceId: string, ...args: any[]): Promise<SpaceInfo> {
    const options: UpdateSpaceOptions =
      args.length > 0 && typeof args[0] === 'object' && args[0] !== null
        ? (args[0] as UpdateSpaceOptions)
        : definedOnly({
            name: args[0],
            description: args[1],
            messageTtlHours: args[2],
            memoryExtractEnabled: args[3],
            memoryExtractIdleSeconds: args[4],
            memoryExtractMaxTokens: args[5],
            memoryExtractMaxMessages: args[6],
            tags: args[7],
            memoryStrategiesBuiltin: args[8],
          });

    const request = new SpaceUpdateRequest(definedOnly(options));

    const controlPlane = await this._ensureControlPlaneInitialized(this.regionName);
    return controlPlane.updateSpace(spaceId, request);
  }

  /** Delete Space (also deletes all associated data). */
  async deleteSpace(spaceId: string): Promise<void> {
    const controlPlane = await this._ensureControlPlaneInitialized(this.regionName);
    await controlPlane.deleteSpace(spaceId);
  }

  // ==================== Data Plane - Session Management ====================

  /**
   * Create a Memory Session.
   *
   * @param spaceId Space ID.
   * @param id Session ID to create (optional).
   * @param actorId Actor ID identifying the user/entity (optional).
   * @param assistantId Assistant ID (optional).
   * @param meta Additional session metadata (optional).
   */
  async createMemorySession(
    spaceId: string,
    id?: string | null,
    actorId?: string | null,
    assistantId?: string | null,
    meta?: JsonDict | null,
  ): Promise<SessionInfo> {
    const sessionRequest = new SessionCreateRequest({
      id,
      actorId,
      assistantId,
      meta,
    });

    return this._dataPlane.createMemorySession(spaceId, sessionRequest);
  }

  /** List sessions in a space. */
  async listSessions(
    spaceId: string,
    actorId?: string | null,
    limit = 20,
    offset = 0,
  ): Promise<SessionListResponse> {
    return this._dataPlane.listSessions(spaceId, actorId, limit, offset);
  }

  /** Delete a session (soft delete). */
  async deleteSession(spaceId: string, sessionId: string): Promise<void> {
    await this._dataPlane.deleteSession(spaceId, sessionId);
  }

  /** Get session details. */
  async getSession(spaceId: string, sessionId: string): Promise<SessionInfo> {
    return this._dataPlane.getSession(spaceId, sessionId);
  }

  // ==================== Data Plane - Message Management ====================

  /** Get the last K messages of a session. */
  async getLastKMessages(
    sessionId: string,
    k: number,
    spaceId: string,
  ): Promise<MessageInfo[]> {
    return this._dataPlane.getLastKMessages(sessionId, k, spaceId);
  }

  /** Get a single message. */
  async getMessage(
    messageId: string,
    spaceId: string,
    sessionId: string,
  ): Promise<MessageInfo> {
    return this._dataPlane.getMessage(messageId, spaceId, sessionId);
  }

  /**
   * Add messages to a session.
   *
   * @param spaceId Space ID.
   * @param sessionId Session ID.
   * @param messages Text, tool call and tool result messages (may be mixed).
   * @param options Keyword-only options (timestamp, idempotencyKey,
   *   isForceExtract).
   */
  async addMessages(
    spaceId: string,
    sessionId: string,
    messages: ClientMessage[],
    options?: ClientAddMessagesOptions,
  ): Promise<MessageBatchResponse> {
    const messageRequests: JsonDict[] = [];

    for (const message of messages) {
      if (
        message instanceof TextMessage ||
        message instanceof ToolCallMessage ||
        message instanceof ToolResultMessage
      ) {
        messageRequests.push(message.toDict());
      } else {
        throw new Error(`Unsupported message type: ${describeType(message)}`);
      }
    }

    return this._dataPlane.addMessages(
      spaceId,
      sessionId,
      messageRequests,
      options?.timestamp,
      options?.idempotencyKey,
      options?.isForceExtract ?? false,
    );
  }

  /** List messages. */
  async listMessages(
    spaceId: string,
    sessionId?: string | null,
    limit = 10,
    offset = 0,
  ): Promise<MessageListResponse> {
    return this._dataPlane.listMessages(spaceId, sessionId, limit, offset);
  }

  // ==================== Data Plane - Memory Management ====================

  /**
   * Create a long-term memory record directly.
   *
   * Accepts an existing request model or an OpenAPI body with snake_case keys.
   */
  async createMemory(
    spaceId: string,
    request: CreateMemoryRequest | JsonDict,
  ): Promise<MemoryInfo> {
    return this._dataPlane.createMemory(spaceId, request);
  }

  /**
   * Update the content or metadata of a long-term memory record.
   *
   * Accepts an existing request model or an OpenAPI body with snake_case keys.
   */
  async updateMemory(
    spaceId: string,
    memoryId: string,
    request: MemoryUpdateRequest | JsonDict,
  ): Promise<MemoryInfo> {
    return this._dataPlane.updateMemory(spaceId, memoryId, request);
  }

  /** Search memories in a Space (semantic similarity). */
  async searchMemories(
    spaceId: string,
    filters?: MemorySearchFilter | null,
  ): Promise<MemorySearchResponse> {
    return this._dataPlane.searchMemories(spaceId, filters);
  }

  /** List memory records in a Space. */
  async listMemories(
    spaceId: string,
    limit = 10,
    offset = 0,
    filters?: MemoryListFilter | null,
  ): Promise<MemoryListResponse> {
    return this._dataPlane.listMemories(spaceId, limit, offset, filters);
  }

  /** Get a memory record. */
  async getMemory(spaceId: string, memoryId: string): Promise<MemoryInfo> {
    return this._dataPlane.getMemory(spaceId, memoryId);
  }

  /** Delete a memory record. */
  async deleteMemory(spaceId: string, memoryId: string): Promise<void> {
    await this._dataPlane.deleteMemory(spaceId, memoryId);
  }

  // ==================== Resource Management ====================

  /**
   * Close the client and release all underlying connections.
   *
   * Python uses `with MemoryClient() as client:`; the Node.js equivalent is
   * `try { ... } finally { await client.close(); }`.
   */
  async close(): Promise<void> {
    if (this._controlPlane !== null) {
      await this._controlPlane.close();
    }
    await this._dataPlane.close();
  }
}

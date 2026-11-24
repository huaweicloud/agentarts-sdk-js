/**
 * Memory operation result models.
 *
 * Ported from `agentarts/toolkit/operations/memory/models.py` (Python
 * `@dataclass` types). Fields use camelCase; `toDict()` emits the Python
 * snake_case wire names so CLI/JSON output stays identical.
 */

/** A space/memory record as returned by the SDK (already camelCase). */
export type MemoryRecordDict = Record<string, any>;

/** Typed outcome shared by session, message and memory data-plane operations. */
export class MemoryDataResult<T = unknown> {
  success = false;
  data?: T;
  error: string | null = null;

  constructor(init?: Partial<MemoryDataResult<T>>) {
    Object.assign(this, init ?? {});
  }
}

/** Result of a space operation (`SpaceResult`). */
export class SpaceResult {
  success: boolean;
  spaceId: string | null = null;
  space: MemoryRecordDict | null = null;
  error: string | null = null;

  constructor(init?: Partial<SpaceResult>) {
    this.success = init?.success ?? false;
    Object.assign(this, init ?? {});
  }

  /** Convert to the Python dict form (snake_case keys). */
  toDict(): Record<string, any> {
    const result: Record<string, any> = { success: this.success };
    if (this.spaceId !== undefined && this.spaceId !== null) result['space_id'] = this.spaceId;
    if (this.space !== undefined && this.space !== null) result['space'] = this.space;
    if (this.error !== undefined && this.error !== null) result['error'] = this.error;
    return result;
  }
}

/** Result of `listSpaces` operation (`SpaceListResult`). */
export class SpaceListResult {
  success: boolean;
  spaces: MemoryRecordDict[] = [];
  total = 0;
  error: string | null = null;

  constructor(init?: Partial<SpaceListResult>) {
    this.success = init?.success ?? false;
    Object.assign(this, init ?? {});
  }

  /** Convert to the Python dict form (snake_case keys). */
  toDict(): Record<string, any> {
    const result: Record<string, any> = {
      success: this.success,
      spaces: this.spaces ?? [],
      total: this.total ?? 0,
    };
    if (this.error !== undefined && this.error !== null) result['error'] = this.error;
    return result;
  }
}

/** Result of a memory operation (`MemoryResult`). */
export class MemoryResult {
  success: boolean;
  memoryId: string | null = null;
  memory: MemoryRecordDict | null = null;
  error: string | null = null;

  constructor(init?: Partial<MemoryResult>) {
    this.success = init?.success ?? false;
    Object.assign(this, init ?? {});
  }

  /** Convert to the Python dict form (snake_case keys). */
  toDict(): Record<string, any> {
    const result: Record<string, any> = { success: this.success };
    if (this.memoryId !== undefined && this.memoryId !== null) result['memory_id'] = this.memoryId;
    if (this.memory !== undefined && this.memory !== null) result['memory'] = this.memory;
    if (this.error !== undefined && this.error !== null) result['error'] = this.error;
    return result;
  }
}

/** Result of `listMemories` operation (`MemoryListResult`). */
export class MemoryListResult {
  success: boolean;
  memories: MemoryRecordDict[] = [];
  total = 0;
  error: string | null = null;

  constructor(init?: Partial<MemoryListResult>) {
    this.success = init?.success ?? false;
    Object.assign(this, init ?? {});
  }

  /** Convert to the Python dict form (snake_case keys). */
  toDict(): Record<string, any> {
    const result: Record<string, any> = {
      success: this.success,
      memories: this.memories ?? [],
      total: this.total ?? 0,
    };
    if (this.error !== undefined && this.error !== null) result['error'] = this.error;
    return result;
  }
}

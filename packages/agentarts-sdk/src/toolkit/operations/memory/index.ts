/**
 * Memory operations module.
 *
 * Ported from `agentarts/toolkit/operations/memory/__init__.py`.
 */

export { MemoryListResult, MemoryResult, SpaceListResult, SpaceResult } from './models.js';
export type { MemoryRecordDict } from './models.js';
export { MemoryDataResult } from './models.js';
export {
  createMemory,
  updateMemory,
  createMemorySession,
  listSessions,
  getSession,
  deleteSession,
  addMessages,
  listMessages,
  getMessage,
  getLastKMessages,
  searchMemories,
  listMemories,
  getMemory,
  deleteMemory,
} from './data.js';
export type { MemoryDataOptions } from './data.js';
export { createSpace, deleteSpace, getSpace, listSpaces, updateSpace } from './space.js';
export type {
  CreateSpaceOptions,
  ListSpacesOptions,
  SpaceOperationOptions,
  UpdateSpaceOptions,
} from './space.js';

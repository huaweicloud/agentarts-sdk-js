/**
 * AgentArts Runtime Context.
 *
 * Provides runtime context management for agent execution, including request
 * tracking, session management, authentication and OAuth2 flow.
 *
 * Python uses `contextvars`; the Node.js port uses `AsyncLocalStorage`, which
 * gives the same per-async-task isolation. A module-level fallback store keeps
 * values readable when code runs outside any request scope (matching Python's
 * default-context behaviour).
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Immutable snapshot of the incoming request context. */
export class RequestContext {
  /** Unique identifier for this request. */
  requestId?: string | null;
  /** Identifier for the user session this request belongs to. */
  sessionId?: string | null;
  /** The underlying transport-specific request object. */
  request?: any;
  /** HTTP peer cancellation. Execution must finish cleanup before releasing its slot. */
  signal?: AbortSignal;

  constructor(init?: Partial<RequestContext>) {
    this.requestId = init?.requestId ?? null;
    this.sessionId = init?.sessionId ?? null;
    this.request = init?.request ?? null;
    this.signal = init?.signal;
  }
}

type ContextStore = Map<string, any>;

const storage = new AsyncLocalStorage<ContextStore>();
const fallbackStore: ContextStore = new Map();

function currentStore(): ContextStore {
  return storage.getStore() ?? fallbackStore;
}

function getValue<T>(key: string): T | null {
  const value = currentStore().get(key);
  return value === undefined ? null : (value as T);
}

function setValue(key: string, value: any): void {
  currentStore().set(key, value);
}

/**
 * Coroutine-safe runtime context backed by `AsyncLocalStorage`.
 *
 * Every attribute is stored independently so concurrent async tasks each get
 * their own isolated view of the context.
 */
export class AgentArtsRuntimeContext {
  static getSessionId(): string | null {
    return getValue<string>('session_id');
  }

  static setSessionId(value: string | null | undefined): void {
    setValue('session_id', value ?? null);
  }

  static getRequestId(): string | null {
    return getValue<string>('request_id');
  }

  static setRequestId(value: string | null | undefined): void {
    setValue('request_id', value ?? null);
  }

  static getWorkloadAccessToken(): string | null {
    return getValue<string>('workload_access_token');
  }

  static setWorkloadAccessToken(value: string | null | undefined): void {
    setValue('workload_access_token', value ?? null);
  }

  static getUserId(): string | null {
    return getValue<string>('user_id');
  }

  static setUserId(value: string | null | undefined): void {
    setValue('user_id', value ?? null);
  }

  static getOauth2CallbackUrl(): string | null {
    return getValue<string>('oauth2_callback_url');
  }

  static setOauth2CallbackUrl(value: string | null | undefined): void {
    setValue('oauth2_callback_url', value ?? null);
  }

  static getUserToken(): string | null {
    return getValue<string>('user_token');
  }

  static setUserToken(value: string | null | undefined): void {
    setValue('user_token', value ?? null);
  }

  static getOauth2CustomState(): string | null {
    return getValue<string>('oauth2_custom_state');
  }

  static setOauth2CustomState(value: string | null | undefined): void {
    setValue('oauth2_custom_state', value ?? null);
  }

  /** Bulk-load context fields from a RequestContext instance. */
  static fromRequestContext(rc: RequestContext): void {
    if (rc.requestId !== null && rc.requestId !== undefined) {
      AgentArtsRuntimeContext.setRequestId(rc.requestId);
    }
    if (rc.sessionId !== null && rc.sessionId !== undefined) {
      AgentArtsRuntimeContext.setSessionId(rc.sessionId);
    }
  }

  /** Create a RequestContext snapshot from the current context. */
  static toRequestContext(): RequestContext {
    return new RequestContext({
      requestId: AgentArtsRuntimeContext.getRequestId(),
      sessionId: AgentArtsRuntimeContext.getSessionId(),
    });
  }

  /** Reset all context variables to `null`. */
  static clear(): void {
    AgentArtsRuntimeContext.setSessionId(null);
    AgentArtsRuntimeContext.setRequestId(null);
    AgentArtsRuntimeContext.setWorkloadAccessToken(null);
    AgentArtsRuntimeContext.setUserId(null);
    AgentArtsRuntimeContext.setOauth2CallbackUrl(null);
    AgentArtsRuntimeContext.setUserToken(null);
    AgentArtsRuntimeContext.setOauth2CustomState(null);
  }

  /**
   * Run a function with a fresh context store.
   *
   * Equivalent to Python's per-request contextvars scope. The runtime app uses
   * this to isolate concurrent invocations.
   */
  static async runInNewContext<T>(fn: () => Promise<T> | T): Promise<T> {
    return storage.run(new Map(), async () => fn());
  }
}

/**
 * Run an async operation from a "synchronous" call site.
 *
 * Node.js has no way to block on a Promise, so the port simply returns the
 * promise. Kept for API parity with the Python helper.
 */
export async function runAsyncInSyncContext<T>(promise: Promise<T>): Promise<T> {
  return promise;
}

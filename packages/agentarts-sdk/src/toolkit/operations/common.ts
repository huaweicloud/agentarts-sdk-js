/** Shared operation results, independent of CLI parsing and presentation. */
import { RequestResult } from '../../sdk/service/http-client.js';

export interface OperationOptions {
  region?: string;
  skipSslVerification?: boolean;
  dataEndpoint?: string;
  authType?: string;
  resourceName?: string;
  sessionId?: string;
  onAuthUrl?: (url: string) => void;
}

export class OperationResult<T = unknown> {
  success = false;
  data: T | undefined;
  error: string | null = null;
  constructor(init?: Partial<OperationResult<T>>) {
    Object.assign(this, init);
  }
}

/** A resource operation always returns a result, including constructor/cleanup failures. */
export async function executeOperation<C>(
  create: () => C,
  run: (client: C) => unknown | Promise<unknown>,
  close?: (client: C) => void | Promise<void>,
): Promise<OperationResult> {
  let client: C | undefined;
  const result = new OperationResult();
  try {
    client = create();
    const value = await run(client);
    if (value instanceof RequestResult) {
      result.data = value.data;
      if (!value.success) throw new Error(value.error || JSON.stringify(value.data));
    } else {
      result.data = value;
    }
    result.success = true;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    if (client !== undefined && close) {
      try {
        await close(client);
      } catch (error) {
        result.success = false;
        result.error = [result.error, `Client cleanup failed: ${String(error)}`]
          .filter(Boolean)
          .join('; ');
      }
    }
  }
  return result;
}

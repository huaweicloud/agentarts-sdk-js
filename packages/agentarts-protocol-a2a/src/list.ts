import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { TaskState, type ListTasksRequest, type ListTasksResponse, type Task } from '@a2a-js/sdk';
import {
  ProtocolHttpError,
  requireIdentifier,
  type ExecutionCoordinator,
  type ExecutionHandle,
  type ExecutionPrincipal,
} from '@huaweicloud/agentarts-sdk/sdk/runtime';

const invalid = (): never => {
  throw new ProtocolHttpError(400, 'INVALID_INPUT', 'Invalid task list parameters or page token');
};
export function validateList(params: Record<string, unknown>): void {
  if (params.contextId !== undefined && params.contextId !== '')
    requireIdentifier(params.contextId, 'contextId');
  if (
    (params.pageSize !== undefined &&
      (!Number.isSafeInteger(params.pageSize) ||
        Number(params.pageSize) < 1 ||
        Number(params.pageSize) > 100)) ||
    (params.includeArtifacts !== undefined && typeof params.includeArtifacts !== 'boolean') ||
    (params.pageToken !== undefined &&
      (typeof params.pageToken !== 'string' || params.pageToken.length > 2048))
  )
    invalid();
  if (params.status !== undefined) {
    const state =
      typeof params.status === 'string'
        ? TaskState[params.status as keyof typeof TaskState]
        : params.status;
    if (typeof state !== 'number' || state < 0 || !Object.values(TaskState).includes(state))
      invalid();
  }
  if (params.statusTimestampAfter !== undefined) {
    const value = params.statusTimestampAfter;
    if (
      typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      invalid();
    const [year, month, day] = (value as string).slice(0, 10).split('-').map(Number) as [
      number,
      number,
      number,
    ];
    if (year < 1 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) invalid();
  }
}

/** Stateless seek cursors are authenticated and bound to identity, mount and filters. */
export function taskListing<T extends { executionId: string; key: string; updatedAt: number }>(
  namespace: string,
  task: (handle: T, historyLength?: number) => Task,
) {
  const secret = randomBytes(32);
  const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest();
  return (
    executions: { list(principal: ExecutionPrincipal): T[] },
    principal: ExecutionPrincipal,
    params: ListTasksRequest,
  ): ListTasksResponse => {
    const query = createHash('sha256')
      .update(
        JSON.stringify([
          namespace,
          principal.tenantId,
          principal.subject,
          params.contextId,
          params.status,
          params.statusTimestampAfter ?? '',
          params.historyLength ?? null,
          params.includeArtifacts ?? false,
        ]),
      )
      .digest('hex');
    let before: { at: number; id: string } | undefined;
    if (params.pageToken) {
      try {
        const [payload, signature, extra] = params.pageToken.split('.');
        if (!payload || !signature || extra !== undefined) invalid();
        const supplied = Buffer.from(signature!, 'base64url');
        const expected = sign(payload!);
        if (
          supplied.toString('base64url') !== signature ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          invalid();
        const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
        if (
          decoded.v !== 1 ||
          decoded.query !== query ||
          !Number.isSafeInteger(decoded.at) ||
          typeof decoded.id !== 'string'
        )
          invalid();
        before = { at: decoded.at, id: decoded.id };
      } catch {
        invalid();
      }
    }
    const filtered = executions
      .list(principal)
      .filter((handle) => handle.key.startsWith(namespace))
      .map((handle) => ({ handle, task: task(handle, params.historyLength) }))
      .filter(
        (entry) =>
          (!params.contextId || entry.task.contextId === params.contextId) &&
          (!params.status || entry.task.status?.state === params.status) &&
          (!params.statusTimestampAfter ||
            entry.handle.updatedAt >= timestampLowerBound(params.statusTimestampAfter)),
      )
      .sort(
        (a, b) =>
          b.handle.updatedAt - a.handle.updatedAt ||
          (a.handle.executionId < b.handle.executionId
            ? 1
            : a.handle.executionId > b.handle.executionId
              ? -1
              : 0),
      );
    const remaining = before
      ? filtered.filter(
          (entry) =>
            entry.handle.updatedAt < before!.at ||
            (entry.handle.updatedAt === before!.at && entry.handle.executionId < before!.id),
        )
      : filtered;
    const pageSize = params.pageSize ?? 50;
    const page = remaining.slice(0, pageSize);
    const last = page.at(-1)?.handle;
    let nextPageToken = '';
    if (last && remaining.length > pageSize) {
      const payload = Buffer.from(
        JSON.stringify({ v: 1, query, at: last.updatedAt, id: last.executionId }),
      ).toString('base64url');
      nextPageToken = `${payload}.${sign(payload).toString('base64url')}`;
    }
    return {
      tasks: page.map((entry) => ({
        ...entry.task,
        artifacts: params.includeArtifacts ? entry.task.artifacts : [],
      })),
      nextPageToken,
      pageSize,
      totalSize: filtered.length,
    };
  };
}

// Task status times have millisecond precision. Round a finer RFC3339 filter up,
// rather than admitting a task that is a fraction of a millisecond too old.
function timestampLowerBound(value: string): number {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  return Date.parse(value) + (/[1-9]/.test(fraction.slice(3)) ? 1 : 0);
}

/** Session, message and memory-record commands using the Memory data plane. */
import { Command, InvalidArgumentError, Option } from 'commander';
import * as memoryOperations from '../../operations/memory/index.js';
import type { MemoryDataResult } from '../../operations/memory/index.js';
import { console, echoError } from '../../utils/common.js';
import { confirm } from '../../plugins/memory/installer/utils.js';

function integer(value: string): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(number)) {
    throw new InvalidArgumentError('Expected a non-negative integer.');
  }
  return number;
}

function positiveInteger(value: string): number {
  const number = integer(value);
  if (number === 0) throw new InvalidArgumentError('Expected a positive integer.');
  return number;
}

function jsonObject(value: string): Record<string, any> {
  const result = JSON.parse(value);
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Expected a JSON object.');
  }
  return result;
}

type Action = (args: string[], options: Record<string, any>) => Promise<MemoryDataResult<unknown>>;

/** Shared CLI flags, confirmation, output and operation-result handling. */
function action(command: Command, run: Action, destructive = false): void {
  command
    .option('-r, --region <region>', 'Region (defaults to HUAWEICLOUD_SDK_REGION)')
    .addOption(
      new Option('-o, --output <format>', 'Output format').choices(['json']).default('json'),
    )
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification');
  if (destructive) command.option('-f, --force', 'Delete without confirmation');
  command.action(async (...raw: any[]) => {
    const current = raw[raw.length - 1] as Command;
    const options = current.opts();
    const args = raw.slice(0, -2) as string[];
    try {
      if (args.some((arg) => !arg.trim())) throw new Error('Resource IDs cannot be empty.');
      if (
        destructive &&
        !options.force &&
        !(await confirm(`Delete ${current.name()} resource '${args[args.length - 1]}'?`, false))
      ) {
        console.print('Deletion cancelled.');
        return;
      }
      const result = await run(args, options);
      if (!result.success) throw new Error(result.error ?? 'Memory operation failed');
      // SDK model instances expose API field names through toDict().
      console.printPlain(
        JSON.stringify(
          result.data === undefined ? { success: true } : result.data,
          (_key, value) => {
            if (typeof value === 'bigint') return value.toString();
            return value && typeof value.toDict === 'function' ? value.toDict() : value;
          },
          2,
        ),
      );
    } catch (error) {
      process.exitCode = 1;
      echoError(error instanceof Error ? error.message : String(error));
    }
  });
}

function pagination(command: Command, defaultLimit: number): Command {
  return command
    .option('-l, --limit <number>', 'Maximum results', positiveInteger, defaultLimit)
    .option('--offset <number>', 'Pagination offset', integer, 0);
}

/** Add the 14 MemoryClient data-plane operations to the existing memory CLI. */
export function registerMemoryDataCommands(memory: Command): void {
  const command = (name: string, description: string) =>
    memory
      .command(name)
      .description(`${description}\nUses HUAWEICLOUD_SDK_MEMORY_API_KEY for authentication.`)
      .argument('<spaceId>', 'Memory Space ID');

  action(
    command('create-session', 'Create a memory session')
      .option('--session-id <id>', 'Optional client-provided session ID')
      .option('--actor-id <id>', 'User/entity ID')
      .option('--assistant-id <id>', 'Assistant ID')
      .option('--meta <json>', 'Session metadata as a JSON object'),
    ([space], o) =>
      memoryOperations.createMemorySession(
        space,
        o.sessionId,
        o.actorId,
        o.assistantId,
        o.meta === undefined ? undefined : jsonObject(o.meta),
        o,
      ),
  );

  action(
    pagination(
      command('list-sessions', 'List memory sessions').option(
        '--actor-id <id>',
        'Filter by user/entity ID',
      ),
      20,
    ),
    ([space], o) => memoryOperations.listSessions(space, o.actorId, o.limit, o.offset, o),
  );

  action(
    command('get-session', 'Get a memory session').argument('<sessionId>', 'Session ID'),
    ([space, session], o) => memoryOperations.getSession(space, session, o),
  );
  action(
    command('delete-session', 'Delete a memory session').argument('<sessionId>', 'Session ID'),
    ([space, session], o) => memoryOperations.deleteSession(space, session, o),
    true,
  );

  action(
    command('add-messages', 'Add text, tool-call or tool-result messages')
      .argument('<sessionId>', 'Session ID')
      .requiredOption(
        '--messages <json>',
        'SDK message array, e.g. [{"role":"user","content":"Hello"}]',
      )
      .option('--timestamp <milliseconds>', 'Client timestamp', integer)
      .option('--idempotency-key <key>', 'Prevent duplicate writes')
      .option('--force-extract', 'Trigger memory extraction'),
    ([space, session], o) =>
      memoryOperations.addMessages(
        space,
        session,
        JSON.parse(o.messages),
        {
          timestamp: o.timestamp,
          idempotencyKey: o.idempotencyKey,
          isForceExtract: o.forceExtract ?? false,
        },
        o,
      ),
  );

  action(
    pagination(
      command('list-messages', 'List messages').option('--session-id <id>', 'Filter by session ID'),
      10,
    ),
    ([space], o) => memoryOperations.listMessages(space, o.sessionId, o.limit, o.offset, o),
  );
  action(
    command('get-message', 'Get a message')
      .argument('<sessionId>', 'Session ID')
      .argument('<messageId>', 'Message ID'),
    ([space, session, message], o) => memoryOperations.getMessage(message, space, session, o),
  );
  action(
    command('last-messages', 'Get the last K messages')
      .argument('<sessionId>', 'Session ID')
      .option('--k <number>', 'Number of messages', positiveInteger, 10),
    ([space, session], o) => memoryOperations.getLastKMessages(session, o.k, space, o),
  );

  action(
    command('search-memories', 'Search extracted memories')
      .option('--query <text>', 'Semantic search query (overrides filters.query)')
      .option('--filters <json>', 'Search filters using API snake_case field names'),
    ([space], o) =>
      memoryOperations.searchMemories(
        space,
        o.filters === undefined && o.query === undefined
          ? undefined
          : {
              ...(o.filters === undefined ? {} : jsonObject(o.filters)),
              ...(o.query === undefined ? {} : { query: o.query }),
            },
        o,
      ),
  );
  action(
    pagination(
      command('list-memories', 'List extracted memories').option(
        '--filters <json>',
        'List filters using API snake_case field names',
      ),
      10,
    ),
    ([space], o) =>
      memoryOperations.listMemories(
        space,
        o.limit,
        o.offset,
        o.filters === undefined ? undefined : jsonObject(o.filters),
        o,
      ),
  );
  action(
    command('create-memory', 'Create a long-term memory record directly').requiredOption(
      '--request <json>',
      'OpenAPI request body (SDK snake_case fields)',
    ),
    ([space], o) => memoryOperations.createMemory(space, jsonObject(o.request), o),
  );
  action(
    command('update-memory', 'Update a long-term memory record')
      .argument('<memoryId>', 'Memory ID')
      .requiredOption('--request <json>', 'OpenAPI request body (content, extraction_meta)'),
    ([space, memory], o) => memoryOperations.updateMemory(space, memory, jsonObject(o.request), o),
  );
  action(
    command('get-memory', 'Get an extracted memory').argument('<memoryId>', 'Memory ID'),
    ([space, memory], o) => memoryOperations.getMemory(space, memory, o),
  );
  action(
    command('delete-memory', 'Delete an extracted memory').argument('<memoryId>', 'Memory ID'),
    ([space, memory], o) => memoryOperations.deleteMemory(space, memory, o),
    true,
  );
}

/**
 * Memory CLI commands - Space management, data-plane operations and plugins.
 *
 * Ported from `agentarts/toolkit/cli/memory/commands.py` (Python `typer`).
 * Existing Space commands retain the Python option names and output formats;
 * data-plane commands additionally expose the MemoryClient business methods.
 */

import { Command, InvalidArgumentError, Option } from 'commander';
import { registerMemoryDataCommands } from './data-commands.js';

import {
  createSpace,
  deleteSpace,
  getSpace,
  listSpaces,
  updateSpace,
} from '../../operations/memory/index.js';
import { Console, echoError, echoSuccess } from '../../utils/common.js';
import { installCmd, uninstallCmd, VALID_TARGETS } from '../../plugins/memory/installer/cli.js';
import { confirm } from '../../plugins/memory/installer/utils.js';

/** Shared `Console` (rich `Console()` counterpart). */
export const console = new Console();

/** Stop a failed command before any SDK call or success output. */
function reportError(message: string): undefined {
  process.exitCode = 1;
  echoError(message);
  return undefined;
}

/** Integer option parser (`typer` int coercion). */
function intArg(value: string): number {
  const parsed = Number(value);
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError('Not a valid integer.');
  }
  return parsed;
}

function booleanArg(value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new InvalidArgumentError('Expected true or false.');
}
function objectArrayArg(value: string): Record<string, any>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new InvalidArgumentError('Expected a JSON object array.');
  }
  if (!Array.isArray(parsed) || parsed.some((v) => !v || typeof v !== 'object' || Array.isArray(v)))
    throw new InvalidArgumentError('Expected a JSON object array.');
  return parsed;
}

/** Float-free numeric option parser used for `--ttl`. */
function ttlArg(value: string): number {
  return intArg(value);
}

/**
 * `json.dumps(..., default=str)` counterpart: stringify non-JSON values.
 */
function jsonDefault(_key: string, value: any): any {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

/** Pretty-print JSON like rich `console.print_json(...)`. */
export function printJson(data: any): void {
  console.printPlain(JSON.stringify(data, jsonDefault, 2) ?? 'null');
}

/** Parsed tags list (`--tags key1=value1,key2=value2`). */
export type TagList = Array<{ key: string; value: string }> | null;

/** Parse the `--strategies` option (comma-separated). */
function parseStrategies(strategies: string | undefined): string[] | null {
  if (!strategies) {
    return null;
  }
  try {
    return strategies.split(',').map((strategy) => strategy.trim());
  } catch {
    echoError('Invalid memory strategies format, use comma-separated values');
    return null;
  }
}

/** Parse the `--tags` option (comma-separated `key=value` pairs). */
function parseTags(tags: string | undefined): TagList | undefined {
  if (!tags) {
    return null;
  }
  let tagsList: TagList = null;
  try {
    tagsList = [];
    for (const tagPair of tags.split(',')) {
      if (!tagPair.includes('=')) {
        return reportError("Invalid tag format, use 'key=value' pairs separated by commas");
      }
      const separator = tagPair.indexOf('=');
      if (separator < 0) {
        // Python: ValueError from `key, value = tag_pair.split("=", 1)`.
        throw new Error('not enough values to unpack');
      }
      tagsList.push({
        key: tagPair.slice(0, separator).trim(),
        value: tagPair.slice(separator + 1).trim(),
      });
    }
  } catch {
    return reportError("Invalid tags format, use 'key1=value1,key2=value2'");
  }
  return tagsList;
}

/**
 * Resolve the `--public/--private` tri-state.
 *
 * `undefined` when neither flag was given (Python default `None`).
 */
function resolvePublicFlag(command: Command): boolean | undefined {
  const publicGiven = command.getOptionValueSource('public') === 'cli';
  const privateGiven = command.getOptionValueSource('private') === 'cli';
  if (privateGiven && !publicGiven) {
    return false;
  }
  if (publicGiven && !privateGiven) {
    return true;
  }
  if (privateGiven && publicGiven) {
    // Both flags: the private flag wins (last-wins in click is ambiguous).
    return false;
  }
  return undefined;
}

/** Options shared by the CRUD commands. */
interface CommonOptions {
  region?: string;
  output: string;
  skipSslVerification: boolean;
}

/** Options of the `create` command. */
interface CreateOptions extends CommonOptions {
  customStrategies?: Record<string, any>[];
  ttl: number;
  description?: string;
  extractIdle?: number;
  extractTokens?: number;
  extractMessages?: number;
  strategies?: string;
  tags?: string;
  public?: boolean;
  private?: boolean;
  vpcId?: string;
  subnetId?: string;
}

/**
 * Create a Memory Space.
 *
 * Uses AK/SK authentication via environment variables:
 * `HUAWEICLOUD_SDK_AK` (access key) and `HUAWEICLOUD_SDK_SK` (secret key).
 */
export async function createSpaceCmd(
  name: string,
  options: CreateOptions,
  command: Command,
): Promise<void> {
  // Input validation.
  if (!name || typeof name !== 'string' || !name.trim()) {
    return reportError('Space name cannot be empty');
  }

  if (name.trim().length > 128) {
    return reportError('Space name cannot exceed 128 characters');
  }

  // Validate TTL values.
  if (options.ttl <= 0 || options.ttl > 8760) {
    return reportError('Message TTL must be between 1 and 8760 hours');
  }

  // Validate the VPC and subnet combination.
  if (
    (options.vpcId === undefined && options.subnetId !== undefined) ||
    (options.vpcId !== undefined && options.subnetId === undefined)
  ) {
    return reportError('Both VPC ID and subnet ID must be provided for private access');
  }

  if (options.vpcId && !options.vpcId.trim()) {
    return reportError('VPC ID cannot be empty if provided');
  }

  if (options.subnetId && !options.subnetId.trim()) {
    return reportError('Subnet ID cannot be empty if provided');
  }

  const memoryStrategiesList = parseStrategies(options.strategies);
  const tagsList = parseTags(options.tags);
  if (tagsList === undefined) return;
  const enablePublic = resolvePublicFlag(command);

  const result = await createSpace(name, {
    messageTtlHours: options.ttl,
    description: options.description ?? null,
    memoryExtractIdleSeconds: options.extractIdle ?? null,
    memoryExtractMaxTokens: options.extractTokens ?? null,
    memoryExtractMaxMessages: options.extractMessages ?? null,
    memoryStrategiesBuiltin: memoryStrategiesList,
    memoryStrategiesCustomized: options.customStrategies,
    tags: tagsList,
    publicAccessEnable: enablePublic ?? true,
    privateVpcId: options.vpcId ? options.vpcId.trim() : null,
    privateSubnetId: options.subnetId ? options.subnetId.trim() : null,
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    return reportError(`Failed to create space: ${result.error}`);
  }

  if (options.output === 'json') {
    try {
      printJson(result.space);
    } catch (error) {
      return reportError(`Failed to serialize space data to JSON: ${_errorMessage(error)}`);
    }
  } else {
    echoSuccess('Space created successfully!');
    console.print(`  Space ID: [bold]${result.spaceId}[/bold]`);
    if (result.space) {
      console.print(`  Status: ${result.space['status'] ?? 'N/A'}`);
    }
  }
}

/** Options of the `get` command. */
interface GetOptions extends CommonOptions {
  region?: string;
}

/**
 * Get Space details.
 *
 * Uses AK/SK authentication via environment variables.
 */
export async function getSpaceCmd(spaceId: string, options: GetOptions): Promise<void> {
  // Input validation.
  if (!spaceId || typeof spaceId !== 'string' || !spaceId.trim()) {
    return reportError('Space ID cannot be empty');
  }

  // Clean up the space ID for display.
  const displaySpaceId = spaceId.trim();
  const result = await getSpace(spaceId, {
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    return reportError(`Failed to get space: ${result.error}`);
  }

  if (options.output === 'json') {
    try {
      printJson(result.space);
    } catch (error) {
      return reportError(`Failed to serialize space data to JSON: ${_errorMessage(error)}`);
    }
  } else {
    const space = result.space ?? {};
    console.printPanel(
      'Space Details',
      `[bold]Space ID:[/bold] ${space['id'] ?? displaySpaceId}\n` +
        `[bold]Project ID:[/bold] ${space['project_id'] ?? 'N/A'}\n` +
        `[bold]Status:[/bold] ${space['status'] ?? 'N/A'}\n` +
        `[bold]Message TTL:[/bold] ${space['message_ttl_hours'] ?? 'N/A'} hours\n` +
        `[bold]Created:[/bold] ${space['created_at'] ?? 'N/A'}`,
      { borderStyle: 'green' },
    );
  }
}

/** Options of the `list` command. */
interface ListOptions extends CommonOptions {
  limit: number;
  offset: number;
  region?: string;
}

/**
 * List Spaces.
 *
 * Uses AK/SK authentication via environment variables.
 */
export async function listSpacesCmd(options: ListOptions): Promise<void> {
  // Validate pagination parameters.
  if (options.limit <= 0) {
    return reportError('Limit must be greater than 0');
  }

  if (options.limit > 100) {
    return reportError('Limit cannot exceed 100');
  }

  if (options.offset < 0) {
    return reportError('Offset must be greater than or equal to 0');
  }

  const result = await listSpaces({
    limit: options.limit,
    offset: options.offset,
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    return reportError(`Failed to list spaces: ${result.error}`);
  }

  if (options.output === 'json') {
    try {
      printJson({ spaces: result.spaces ?? [], total: result.total ?? 0 });
    } catch (error) {
      return reportError(`Failed to serialize spaces data to JSON: ${_errorMessage(error)}`);
    }
  } else {
    console.print(`Spaces (Total: ${result.total})`);
    const rows = (result.spaces ?? []).map((space) => [
      space['id'] ?? 'N/A',
      space['project_id'] ?? 'N/A',
      space['status'] ?? 'N/A',
      String(space['message_ttl_hours'] ?? 'N/A'),
      space['created_at'] ?? 'N/A',
    ]);
    console.printTable(rows, ['Space ID', 'Project ID', 'Status', 'Message TTL', 'Created']);
  }
}

/** Options of the `update` command. */
interface UpdateOptions extends CommonOptions {
  name?: string;
  extractEnabled?: boolean;
  ttl?: number;
  description?: string;
  extractIdle?: number;
  extractTokens?: number;
  extractMessages?: number;
  strategies?: string;
  tags?: string;
  region?: string;
}

/**
 * Update a Space.
 *
 * Uses AK/SK authentication via environment variables.
 */
export async function updateSpaceCmd(
  spaceId: string,
  options: UpdateOptions,
  command: Command,
): Promise<void> {
  // Input validation.
  if (!spaceId || typeof spaceId !== 'string' || !spaceId.trim()) {
    return reportError('Space ID cannot be empty');
  }

  // Clean up the space ID.
  const cleanSpaceId = spaceId.trim();

  // Validate TTL if provided.
  if (options.ttl !== undefined && (options.ttl <= 0 || options.ttl > 8760)) {
    return reportError('Message TTL must be between 1 and 8760 hours');
  }

  if (options.name !== undefined && (!options.name.trim() || options.name.length > 128))
    return reportError('Space name must contain 1-128 characters');

  const memoryStrategiesList = parseStrategies(options.strategies);
  const tagsList = parseTags(options.tags);
  if (tagsList === undefined) return;

  const result = await updateSpace(cleanSpaceId, {
    name: options.name,
    enableMemoryExtract: options.extractEnabled,
    messageTtlHours: options.ttl ?? null,
    description: options.description ?? null,
    memoryExtractIdleSeconds: options.extractIdle ?? null,
    memoryExtractMaxTokens: options.extractTokens ?? null,
    memoryExtractMaxMessages: options.extractMessages ?? null,
    memoryStrategiesBuiltin: memoryStrategiesList,
    tags: tagsList,
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    return reportError(`Failed to update space: ${result.error}`);
  }

  if (options.output === 'json') {
    try {
      printJson({ space_id: cleanSpaceId, space: result.space ?? null });
    } catch (error) {
      return reportError(`Failed to serialize space data to JSON: ${_errorMessage(error)}`);
    }
  } else {
    echoSuccess('Space updated successfully!');
    console.print(`  Space ID: [bold]${cleanSpaceId}[/bold]`);

    // Show more details if available.
    if (result.space) {
      const status = result.space['status'] ?? 'N/A';
      const projectId = result.space['project_id'] ?? 'N/A';
      const messageTtl = result.space['message_ttl_hours'] ?? 'N/A';

      console.print(`  Status: ${status}`);
      console.print(`  Project ID: ${projectId}`);
      if (messageTtl !== 'N/A') {
        console.print(`  Message TTL: ${messageTtl} hours`);
      }

      // Show the updates that were made.
      const updates: string[] = [];
      if (options.ttl !== undefined) {
        updates.push(`TTL set to ${messageTtl} hours`);
      }

      if (updates.length > 0) {
        console.print(`  Updates: ${updates.join(', ')}`);
      }
    }
  }
}

/** Options of the `delete` command. */
interface DeleteOptions extends CommonOptions {
  region?: string;
  force: boolean;
}

/**
 * Delete a Space.
 *
 * Uses AK/SK authentication via environment variables.
 *
 * @returns Process exit code (0 when cancelled).
 */
export async function deleteSpaceCmd(spaceId: string, options: DeleteOptions): Promise<number> {
  // Validate the space ID.
  if (!spaceId || typeof spaceId !== 'string' || !spaceId.trim()) {
    reportError('Space ID cannot be empty');
    return 1;
  }

  // Clean up the space ID for display.
  const displaySpaceId = spaceId.trim();

  if (!options.force) {
    const confirmed = await confirm(`Are you sure you want to delete space '${displaySpaceId}'?`);
    if (!confirmed) {
      console.print('[yellow]Deletion cancelled.[/yellow]');
      return 0;
    }
  }

  const result = await deleteSpace(spaceId, {
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    reportError(`Failed to delete space: ${result.error}`);
    return 1;
  }

  echoSuccess('Space deleted successfully!');
  console.print(`  Space ID: [bold]${displaySpaceId}[/bold]`);
  return 0;
}

/** Options of the `status` command. */
interface StatusOptions extends CommonOptions {
  region?: string;
}

/**
 * Check the status of a Memory Space.
 *
 * Provides a simplified view of the space status showing only essential
 * information such as available status and health.
 *
 * Uses AK/SK authentication via environment variables.
 */
export async function spaceStatusCmd(spaceId: string, options: StatusOptions): Promise<void> {
  // Input validation.
  if (!spaceId || typeof spaceId !== 'string' || !spaceId.trim()) {
    return reportError('Space ID cannot be empty');
  }

  // Clean up the space ID for display.
  const displaySpaceId = spaceId.trim();

  const result = await getSpace(spaceId, {
    region: options.region ?? null,
    skipSslVerification: options.skipSslVerification,
  });

  if (!result.success) {
    return reportError(`Failed to get space status: ${result.error}`);
  }

  // Format the output based on the user preference.
  if (options.output === 'json') {
    try {
      const outputData: Record<string, any> = {
        space_id: displaySpaceId,
        status_available: null,
        project_id: null,
        created_at: null,
        updated_at: null,
        health_status: null,
      };

      if (result.space) {
        // Extract essential status information.
        outputData['status_available'] = {
          status: result.space['status'] ?? 'unknown',
          message_ttl_hours: result.space['message_ttl_hours'] ?? null,
          enable_memory_extract: result.space['enable_memory_extract'] ?? null,
        };
        outputData['project_id'] = result.space['project_id'] ?? null;
        outputData['created_at'] = result.space['created_at'] ?? null;
        outputData['updated_at'] = result.space['updated_at'] ?? null;

        // Determine the health status based on various indicators.
        const status = String(result.space['status'] ?? '').toUpperCase();
        const ttl = result.space['message_ttl_hours'];
        const memoryExtract = result.space['enable_memory_extract'];

        let health = 'healthy';
        if (status === 'ERROR' || status === 'FAILED') {
          health = 'error';
        } else if (
          status === 'STOPPED' ||
          status === 'INACTIVE' ||
          (ttl !== null && ttl !== undefined && ttl < 24) ||
          (memoryExtract === false && result.space['status'] === 'ACTIVE')
        ) {
          health = 'warning';
        }

        outputData['health_status'] = health;
      }

      printJson(outputData);
    } catch (error) {
      return reportError(`Failed to serialize space status to JSON: ${_errorMessage(error)}`);
    }
  } else {
    // Table format - focus on status.
    const statusInfo = result.space ? String(result.space['status'] ?? 'unknown') : 'unknown';

    // Determine health status based on the space status.
    let healthStatus: string;
    if (['ACTIVE', 'RUNNING', 'READY'].includes(statusInfo.toUpperCase())) {
      healthStatus = 'healthy';
    } else if (['STOPPED', 'INACTIVE', 'WARNING'].includes(statusInfo.toUpperCase())) {
      healthStatus = 'warning';
    } else if (['ERROR', 'FAILED'].includes(statusInfo.toUpperCase())) {
      healthStatus = 'error';
    } else {
      healthStatus = 'unknown';
    }

    // Build a more comprehensive status panel.
    let statusContent =
      `[bold]Space ID:[/bold] ${displaySpaceId}\n` +
      `[bold]Status:[/bold] ${statusInfo}\n` +
      `[bold]Health:[/bold] ${_titleCase(healthStatus)}`;

    if (result.space) {
      statusContent += `\n[bold]Project:[/bold] ${result.space['project_id'] ?? 'N/A'}`;
      statusContent += `\n[bold]Created:[/bold] ${result.space['created_at'] ?? 'N/A'}`;
      statusContent += `\n[bold]TTL:[/bold] ${result.space['message_ttl_hours'] ?? 'N/A'} hours`;

      // Add the memory extraction status.
      const memoryExtract = result.space['enable_memory_extract'];
      if (memoryExtract !== null && memoryExtract !== undefined) {
        statusContent += `\n[bold]Memory Extract:[/bold] ${memoryExtract ? 'Enabled' : 'Disabled'}`;
      }
    }

    console.printPanel('Memory Space Status', statusContent, { borderStyle: 'cyan' });

    // Show additional warnings or information if available.
    if (result.space) {
      // Show a warning if the message TTL is about to expire.
      const ttl = result.space['message_ttl_hours'];
      if (ttl && ttl < 24) {
        console.print(`[yellow]\u26a0\ufe0f  Warning: Message TTL is low (${ttl} hours)[/yellow]`);
      }

      // Show region information.
      const regionInfo = result.space['region'];
      if (regionInfo) {
        console.print(`  Region: [cyan]${regionInfo}[/cyan]`);
      }
    }
  }
}

/** Python `str.title()` counterpart for the health label. */
function _titleCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** `str(exc)` counterpart. */
function _errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Options accepted by the `install` sub-command. */
interface InstallRegisterOptions {
  global?: boolean;
  yes?: boolean;
}

/**
 * Build the `memory` command tree.
 *
 * Includes Space CRUD, session/message/memory operations and plugin installation.
 */
export function buildMemoryCommand(): Command {
  const memoryApp = new Command('memory')
    .description('Memory Space, session, message, memory record and plugin management')
    .allowExcessArguments(true);

  memoryApp
    .command('create')
    .description(
      'Create a Memory Space.\n\n' +
        'Uses AK/SK authentication via environment variables:\n' +
        '- HUAWEICLOUD_SDK_AK: Access Key\n' +
        '- HUAWEICLOUD_SDK_SK: Secret Key',
    )
    .argument('<name>', 'Space name, required (1-128 characters)')
    .option('-t, --ttl <hours>', 'Message TTL in hours', ttlArg, 168)
    .option('-d, --description <description>', 'Space description')
    .option('--extract-idle <seconds>', 'Memory extraction idle time in seconds', intArg)
    .option('--extract-tokens <tokens>', 'Memory extraction max tokens', intArg)
    .option('--extract-messages <messages>', 'Memory extraction max messages', intArg)
    .option('-s, --strategies <strategies>', 'Built-in memory strategies (comma-separated)')
    .option(
      '--custom-strategies <json>',
      'Custom memory strategies (JSON object array)',
      objectArrayArg,
    )
    .option('--tags <tags>', "Tags in format 'key1=value1,key2=value2'")
    .option('--public', 'Enable public access (default)')
    .option('--private', 'Disable public access')
    .option('--vpc-id <vpcId>', 'Private VPC ID (requires --subnet-id)')
    .option('--subnet-id <subnetId>', 'Private subnet ID (requires --vpc-id)')
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .addOption(
      new Option('-o, --output <format>', 'Output format')
        .choices(['table', 'json'])
        .default('table'),
    )
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (name: string, options: Record<string, any>, command: Command) => {
      await createSpaceCmd(name, normalizeOptions(options) as CreateOptions, command);
    });

  memoryApp
    .command('get')
    .description('Get Space details.\n\nUses AK/SK authentication via environment variables.')
    .argument('<spaceId>', 'Space ID')
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .addOption(
      new Option('-o, --output <format>', 'Output format')
        .choices(['table', 'json'])
        .default('table'),
    )
    .option('--skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (spaceId: string, options: Record<string, any>) => {
      await getSpaceCmd(spaceId, normalizeOptions(options) as GetOptions);
    });

  memoryApp
    .command('list')
    .description('List Spaces.\n\nUses AK/SK authentication via environment variables.')
    .option('-l, --limit <limit>', 'Maximum number of spaces', intArg, 20)
    .option('--offset <offset>', 'Offset for pagination', intArg, 0)
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .addOption(
      new Option('-o, --output <format>', 'Output format')
        .choices(['table', 'json'])
        .default('table'),
    )
    .option('--skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (options: Record<string, any>) => {
      await listSpacesCmd(normalizeOptions(options) as ListOptions);
    });

  memoryApp
    .command('update')
    .description('Update a Space.\n\nUses AK/SK authentication via environment variables.')
    .argument('<spaceId>', 'Space ID')
    .option('-n, --name <name>', 'New space name')
    .option('--extract-enabled <boolean>', 'Enable memory extraction (true/false)', booleanArg)
    .option('-t, --ttl <hours>', 'Message TTL in hours', intArg)
    .option('-d, --description <description>', 'Space description')
    .option('--extract-idle <seconds>', 'Memory extraction idle time in seconds', intArg)
    .option('--extract-tokens <tokens>', 'Memory extraction max tokens', intArg)
    .option('--extract-messages <messages>', 'Memory extraction max messages', intArg)
    .option('-s, --strategies <strategies>', 'Built-in memory strategies (comma-separated)')
    .option('--tags <tags>', "Tags in format 'key1=value1,key2=value2'")
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .addOption(
      new Option('-o, --output <format>', 'Output format')
        .choices(['table', 'json'])
        .default('table'),
    )
    .option('--skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (spaceId: string, options: Record<string, any>, command: Command) => {
      await updateSpaceCmd(spaceId, normalizeOptions(options) as UpdateOptions, command);
    });

  memoryApp
    .command('delete')
    .description('Delete a Space.\n\nUses AK/SK authentication via environment variables.')
    .argument('<spaceId>', 'Space ID')
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .option('-f, --force', 'Force deletion without confirmation')
    .option('--skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (spaceId: string, options: Record<string, any>) => {
      const code = await deleteSpaceCmd(spaceId, normalizeOptions(options) as DeleteOptions);
      if (code) {
        process.exitCode = code;
      }
    });

  memoryApp
    .command('status')
    .description(
      'Check the status of a Memory Space.\n\n' +
        'This command provides a simplified view of space status showing only\n' +
        'the essential information like available status and health.\n\n' +
        'Uses AK/SK authentication via environment variables:\n' +
        '- HUAWEICLOUD_SDK_AK: Access Key\n' +
        '- HUAWEICLOUD_SDK_SK: Secret Key',
    )
    .argument('<spaceId>', 'Space ID to check status')
    .option('-r, --region <region>', 'Region name (default: cn-north-4)')
    .addOption(
      new Option('-o, --output <format>', 'Output format')
        .choices(['table', 'json'])
        .default('table'),
    )
    .option('--skip-ssl-verification', 'Skip SSL certificate verification')
    .action(async (spaceId: string, options: Record<string, any>) => {
      await spaceStatusCmd(spaceId, normalizeOptions(options) as StatusOptions);
    });

  // Register the installer's install/uninstall commands onto the shared memory
  // app: `agentarts memory install|uninstall`.
  memoryApp
    .command('install')
    .description('Install the AgentArts Memory plugin for a supported AI agent.')
    .argument('[target]', `Platform (${VALID_TARGETS.join(', ')}). Omit to detect.`)
    .option('--global', 'Install to user-level config.')
    .option('-y, --yes', 'Auto-confirm all prompts.')
    .action(async (target: string | undefined, options: InstallRegisterOptions) => {
      const code = await installCmd({
        target: target ?? null,
        globalScope: options.global ?? false,
        yes: options.yes ?? false,
      });
      if (code) {
        process.exitCode = code;
      }
    });

  memoryApp
    .command('uninstall')
    .description('Uninstall an AgentArts Memory plugin.')
    .argument('[target]', `Platform (${VALID_TARGETS.join(', ')}). Omit to select.`)
    .option('--global', 'Limit to user-level installs.')
    .option('-y, --yes', 'Auto-confirm all prompts.')
    .action(async (target: string | undefined, options: InstallRegisterOptions) => {
      const code = await uninstallCmd({
        target: target ?? null,
        globalScope: options.global ?? false,
        yes: options.yes ?? false,
      });
      if (code) {
        process.exitCode = code;
      }
    });

  registerMemoryDataCommands(memoryApp);
  return memoryApp;
}

/**
 * Map commander's kebab-case option keys to the camelCase names used by the
 * command implementations (`skip-ssl-verification` -> `skipSslVerification`).
 */
function normalizeOptions(options: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...options };
  if ('skip-ssl-verification' in normalized) {
    normalized['skipSslVerification'] = normalized['skip-ssl-verification'];
  }
  return normalized;
}

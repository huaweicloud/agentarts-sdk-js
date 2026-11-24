/**
 * AgentArts Gateway CLI Commands.
 *
 * Provides CLI commands for MCP (Model Context Protocol) gateway operations.
 */

import { createInterface } from 'node:readline/promises';
import { Command, InvalidArgumentError } from 'commander';

import { createGatewayOperations } from '../../operations/gateway/index.js';
import type { RequestResult } from '../../../sdk/service/http-client.js';
import { echoError, echoSuccess, echoWarning } from '../../utils/common.js';

/** Parse a JSON string to an object. */
export function parseJson(value?: string | null, kind: 'object' | 'array' = 'object'): any {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) !== (kind === 'array')) {
      throw new Error('Invalid JSON format');
    }
    return parsed;
  } catch {
    throw new Error('Invalid JSON format');
  }
}

function resourceId(value: string): string {
  if (!value.trim()) throw new InvalidArgumentError('Resource ID cannot be empty');
  return value;
}

function getGatewayClient(verifySsl = true) {
  return createGatewayOperations(verifySsl);
}

/** Format data as indented JSON, or as a string when serialization fails. */
export function formatOutput(data: any): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function handleError(operation: string, result: Pick<RequestResult, 'data' | 'error'>): void {
  if (
    result.data !== null &&
    typeof result.data === 'object' &&
    'error_msg' in (result.data as any) &&
    'error_code' in (result.data as any)
  ) {
    process.exitCode = 1;
    echoError(
      `Error ${operation} (Code: ${(result.data as any)['error_code']}): ${(result.data as any)['error_msg']}`,
    );
  } else {
    process.exitCode = 1;
    echoError(`Error ${operation}: ${result.data ? formatOutput(result.data) : result.error}`);
  }
}

async function confirm(message: string, defaultValue = false): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await readline.question(`${message} ${defaultValue ? '[Y/n]' : '[y/N]'}: `))
      .trim()
      .toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    return answer === 'y' || answer === 'yes';
  } finally {
    readline.close();
  }
}

function validatePagination(options: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  for (const [name, value] of Object.entries(options)) {
    if (value !== undefined && !Number.isSafeInteger(value)) {
      throw new Error(`${name} must be a safe integer`);
    }
  }
  let offset = options.offset;
  if (offset === undefined) {
    offset = 0;
  } else if (offset < 0) {
    throw new Error('Offset must be greater than or equal to 0');
  } else if (offset > 100000) {
    throw new Error('Offset must be less than or equal to 100000');
  }

  let limit = options.limit;
  if (limit === undefined) {
    limit = 50;
  } else if (limit < 1) {
    throw new Error('Limit must be greater than 0');
  } else if (limit > 100) {
    throw new Error('Limit must be less than or equal to 100');
  }
  return { limit, offset };
}

function commaList(value?: string | null): string[] | null {
  return value ? value.split(',') : null;
}

/** Build the `agentarts gateway` command tree. */
export function createGatewayCommand(): Command {
  const gateway = new Command('gateway').description('Gateway management commands');

  gateway
    .command('create')
    .description('Create a new gateway')
    .option('-n, --name <name>', 'Gateway name')
    .option('-d, --description <description>', 'Gateway description')
    .option('--protocol-type <type>', 'Protocol type (default: mcp)', 'mcp')
    .option('--authorizer-type <type>', 'Authorizer type (default: iam)', 'iam')
    .option('--agency-name <name>', 'Agency name')
    .option('--authorizer-configuration <json>', 'Authorizer configuration (JSON format)')
    .option('--protocol-configuration <json>', 'Protocol configuration (JSON format)')
    .option('--log-delivery-configuration <json>', 'Log delivery configuration (JSON format)')
    .option(
      '--outbound-network-configuration <json>',
      'Outbound network configuration (JSON format)',
    )
    .option('--tags <json>', 'Resource tags (JSON format)')
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.createGateway({
          name: options.name,
          description: options.description,
          protocolType: options.protocolType,
          authorizerType: options.authorizerType,
          agencyName: options.agencyName,
          authorizerConfiguration: parseJson(options.authorizerConfiguration),
          protocolConfiguration: parseJson(options.protocolConfiguration),
          logDeliveryConfiguration: parseJson(options.logDeliveryConfiguration),
          outboundNetworkConfiguration: parseJson(options.outboundNetworkConfiguration),
          tags: parseJson(options.tags, 'array') as any,
        });

        if (result.success) {
          echoSuccess('Gateway created successfully:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('creating gateway', result);
        }
      } catch (error) {
        process.exitCode = 1;
        if (error instanceof Error && error.message === 'Invalid JSON format') {
          echoError(error.message);
        } else {
          echoError(`Unexpected error: ${error}`);
        }
      }
    });

  gateway
    .command('update')
    .description('Update an existing gateway')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .option('-d, --description <description>', 'Gateway description')
    .option('--protocol-configuration <json>', 'Protocol configuration (JSON format)')
    .option('--log-delivery-configuration <json>', 'Log delivery configuration (JSON format)')
    .option('--tags <json>', 'Resource tags (JSON format)')
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.updateGateway(gatewayId, {
          description: options.description,
          protocolConfiguration: parseJson(options.protocolConfiguration),
          logDeliveryConfiguration: parseJson(options.logDeliveryConfiguration),
          tags: parseJson(options.tags, 'array') as any,
        });

        if (result.success) {
          echoSuccess('Gateway updated successfully:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('updating gateway', result);
        }
      } catch (error) {
        process.exitCode = 1;
        if (error instanceof Error && error.message === 'Invalid JSON format') {
          echoError(error.message);
        } else {
          echoError(`Unexpected error: ${error}`);
        }
      }
    });

  gateway
    .command('delete')
    .description('Delete a gateway')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, options: Record<string, any>) => {
      try {
        echoWarning(
          `Are you sure you want to delete gateway ${gatewayId}? This action cannot be undone.`,
        );
        if (!(await confirm('Do you want to proceed?'))) {
          echoSuccess('Deletion cancelled');
          return;
        }

        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.deleteGateway(gatewayId);
        if (result.success) {
          echoSuccess('Gateway deleted successfully');
        } else {
          handleError('deleting gateway', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  gateway
    .command('get')
    .description('Get details of a gateway')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.getGateway(gatewayId);
        if (result.success) {
          echoSuccess('Gateway details:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('getting gateway', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  gateway
    .command('list')
    .description('List gateways')
    .option('--name <name>', 'Gateway name')
    .option('--status <status>', 'Gateway status')
    .option('--gateway-id <id>', 'Gateway ID')
    .option('--tag-key-exists <keys>', 'Tag key exists filter (comma-separated)')
    .option('--tag-key-matches <keys>', 'Tag key matches filter (comma-separated)')
    .option('--tag-value-matches <values>', 'Tag value matches filter (comma-separated)')
    .option('--tag-match-policy <policy>', 'Tag match policy (ALL/ANY)')
    .option('--limit <number>', 'Limit for pagination (default: 50, min: 1, max: 100)')
    .option('--offset <number>', 'Offset for pagination (default: 0, min: 0, max: 100000)')
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (options: Record<string, any>) => {
      try {
        const { limit, offset } = validatePagination({
          limit: options.limit !== undefined ? Number(options.limit) : undefined,
          offset: options.offset !== undefined ? Number(options.offset) : undefined,
        });

        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.listGateways({
          name: options.name,
          status: options.status,
          gatewayId: options.gatewayId,
          tagKeyExists: commaList(options.tagKeyExists),
          tagKeyMatches: commaList(options.tagKeyMatches),
          tagValueMatches: commaList(options.tagValueMatches),
          tagMatchPolicy: options.tagMatchPolicy,
          limit,
          offset,
        });

        if (result.success) {
          echoSuccess(`Total gateways: ${(result.data as any)?.total ?? 0}`);
          echoSuccess('Gateways:');
          echoSuccess(formatOutput((result.data as any)?.gateways ?? []));
        } else {
          handleError('listing gateways', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  gateway
    .command('create-target')
    .description('Create a new gateway target')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .requiredOption('--target-configuration <json>', 'Target configuration (JSON format)')
    .option('-n, --name <name>', 'Target name')
    .option('-d, --description <description>', 'Target description')
    .option(
      '--credential-provider-configuration <json>',
      'Credential provider configuration (JSON format)',
    )
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.createGatewayTarget(gatewayId, {
          name: options.name,
          description: options.description,
          targetConfiguration: parseJson(options.targetConfiguration),
          credentialProviderConfiguration: parseJson(options.credentialProviderConfiguration),
        });

        if (result.success) {
          echoSuccess('Target created successfully:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('creating target', result);
        }
      } catch (error) {
        process.exitCode = 1;
        if (error instanceof Error && error.message === 'Invalid JSON format') {
          echoError(error.message);
        } else {
          echoError(`Unexpected error: ${error}`);
        }
      }
    });

  gateway
    .command('update-target')
    .description('Update an existing gateway target')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .argument('<targetId>', 'Target ID', resourceId)
    .option('-n, --name <name>', 'Target name')
    .option('-d, --description <description>', 'Target description')
    .option('--target-configuration <json>', 'Target configuration (JSON format)')
    .option(
      '--credential-provider-configuration <json>',
      'Credential provider configuration (JSON format)',
    )
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, targetId: string, options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.updateGatewayTarget(gatewayId, targetId, {
          name: options.name,
          description: options.description,
          targetConfiguration: parseJson(options.targetConfiguration),
          credentialProviderConfiguration: parseJson(options.credentialProviderConfiguration),
        });

        if (result.success) {
          echoSuccess('Target updated successfully:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('updating target', result);
        }
      } catch (error) {
        process.exitCode = 1;
        if (error instanceof Error && error.message === 'Invalid JSON format') {
          echoError(error.message);
        } else {
          echoError(`Unexpected error: ${error}`);
        }
      }
    });

  gateway
    .command('delete-target')
    .description('Delete a gateway target')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .argument('<targetId>', 'Target ID', resourceId)
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, targetId: string, options: Record<string, any>) => {
      try {
        echoWarning(
          `Are you sure you want to delete target ${targetId} from gateway ${gatewayId}? This action cannot be undone.`,
        );
        if (!(await confirm('Do you want to proceed?'))) {
          echoSuccess('Deletion cancelled');
          return;
        }

        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.deleteGatewayTarget(gatewayId, targetId);
        if (result.success) {
          echoSuccess('Target deleted successfully');
        } else {
          handleError('deleting target', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  gateway
    .command('get-target')
    .description('Get details of a gateway target')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .argument('<targetId>', 'Target ID', resourceId)
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, targetId: string, options: Record<string, any>) => {
      try {
        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.getGatewayTarget(gatewayId, targetId);
        if (result.success) {
          echoSuccess('Target details:');
          echoSuccess(formatOutput(result.data));
        } else {
          handleError('getting target', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  gateway
    .command('list-targets')
    .description('List gateway targets')
    .argument('<gatewayId>', 'Gateway ID', resourceId)
    .option('--limit <number>', 'Limit for pagination (default: 50, min: 1, max: 100)')
    .option('--offset <number>', 'Offset for pagination (default: 0, min: 0, max: 100000)')
    .option('-k, --skip-ssl-verification', 'Skip SSL certificate verification', false)
    .action(async (gatewayId: string, options: Record<string, any>) => {
      try {
        const { limit, offset } = validatePagination({
          limit: options.limit !== undefined ? Number(options.limit) : undefined,
          offset: options.offset !== undefined ? Number(options.offset) : undefined,
        });

        const client = getGatewayClient(!options.skipSslVerification);
        const result = await client.listGatewayTargets(gatewayId, { limit, offset });
        if (result.success) {
          echoSuccess(`Total targets: ${(result.data as any)?.total ?? 0}`);
          echoSuccess('Targets:');
          echoSuccess(formatOutput((result.data as any)?.targets ?? []));
        } else {
          handleError('listing targets', result);
        }
      } catch (error) {
        process.exitCode = 1;
        echoError(`Unexpected error: ${error}`);
      }
    });

  return gateway;
}

/** Register gateway commands on an existing program. */
export function registerGatewayCommands(program: Command): void {
  program.addCommand(createGatewayCommand());
}

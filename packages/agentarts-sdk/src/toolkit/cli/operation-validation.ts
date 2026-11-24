/** Validate JSON fields whose SDK signatures use typed options rather than arbitrary records.
 * API-specific constraints (UUIDs, names, enum values, etc.) remain with the SDK.
 */
import type { OperationCommand } from './operation-commands.js';

type Kind = 'string' | 'number' | 'boolean' | 'object' | 'objects' | 'strings';
type Schema = Record<string, Kind>;
function check(
  value: Record<string, any>,
  schema: Schema,
  required: string[],
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key))
      throw new Error(`Unknown SDK option: ${label}.${key}`);
  }
  for (const key of required) {
    if (typeof value[key] !== 'string' || !value[key].trim())
      throw new Error(`${label}.${key} is required and must be a non-empty string`);
  }
  for (const [key, kind] of Object.entries(schema)) {
    const item = value[key];
    if (item === undefined || item === null) continue;
    const valid =
      kind === 'objects'
        ? Array.isArray(item) &&
          item.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))
        : kind === 'strings'
          ? Array.isArray(item) && item.every((v) => typeof v === 'string')
          : kind === 'object'
            ? typeof item === 'object' && !Array.isArray(item)
            : typeof item === kind && (kind !== 'number' || Number.isFinite(item));
    if (!valid) throw new Error(`${label}.${key} must be ${kind}`);
    if (
      ['limit', 'offset'].includes(key) &&
      (!Number.isSafeInteger(item) || item < (key === 'limit' ? 1 : 0))
    )
      throw new Error(
        `${label}.${key} must be a ${key === 'limit' ? 'positive' : 'non-negative'} safe integer`,
      );
  }
}

const agentOptions: Schema = {
  description: 'string',
  artifactSourceConfig: 'object',
  envVars: 'objects',
  identityConfig: 'object',
  executionAgencyName: 'string',
  networkConfig: 'object',
  agentGatewayId: 'string',
  invokeConfig: 'object',
  observabilityConfig: 'object',
  storageConfig: 'object',
  tagsConfig: 'objects',
  lifecycleConfig: 'object',
  extra: 'object',
};
const identityOptions: Record<string, { schema: Schema; required: string[] }> = {
  getResourceApiKey: {
    schema: { providerName: 'string', workloadAccessToken: 'string' },
    required: ['providerName', 'workloadAccessToken'],
  },
  getResourceOauth2Token: {
    schema: {
      providerName: 'string',
      workloadAccessToken: 'string',
      authFlow: 'string',
      scopes: 'strings',
      callbackUrl: 'string',
      forceAuthentication: 'boolean',
      customState: 'string',
      customParameters: 'object',
    },
    required: ['providerName', 'workloadAccessToken', 'authFlow'],
  },
  getResourceStsToken: {
    schema: {
      providerName: 'string',
      workloadAccessToken: 'string',
      agencySessionName: 'string',
      durationSeconds: 'number',
      policy: 'string',
      sourceIdentity: 'string',
      tags: 'objects',
      transitiveTagKeys: 'strings',
    },
    required: ['providerName', 'workloadAccessToken', 'agencySessionName'],
  },
};

export function validateStructuredArguments(
  group: string,
  definition: OperationCommand,
  args: any[],
): void {
  const index = definition.fields.findIndex((f) => f.key === 'options');
  const options = args[index];
  if (options === undefined) return;
  if (group === 'identity') {
    if (
      definition.method === 'getResourceOauth2Token' &&
      (options.tokenPoller !== undefined || options.onAuthUrl !== undefined)
    )
      throw new Error('Callback functions and pollers cannot be supplied as JSON');
    const rule = identityOptions[definition.method];
    if (rule) {
      check(options, rule.schema, rule.required, '--options');
      if (
        definition.method === 'getResourceOauth2Token' &&
        !['M2M', 'USER_FEDERATION'].includes(options.authFlow)
      )
        throw new Error('--options.authFlow must be M2M or USER_FEDERATION');
    }
  }
  if (group === 'runtime') {
    // Each method has its own SDK Options contract; extra is the explicit escape hatch.
    const { identityConfig: _identityConfig, ...updateAgentOptions } = agentOptions;
    const schemas: Record<string, Schema> = {
      createAgent: agentOptions,
      createOrUpdateAgent: agentOptions,
      updateAgent: updateAgentOptions,
      getAgents: { agentName: 'string', limit: 'number', offset: 'number', extra: 'object' },
      createAgentEndpoint: { endpointType: 'string', config: 'object', extra: 'object' },
      updateAgentEndpoint: { config: 'object', extra: 'object' },
      pingAgent: {
        bearerToken: 'string',
        endpoint: 'string',
        sessionId: 'string',
        timeout: 'number',
        userId: 'string',
      },
    };
    const schema = schemas[definition.method];
    if (!schema) throw new Error(`No SDK options schema for ${definition.method}`);
    check(options, schema, [], '--options');
  }
}

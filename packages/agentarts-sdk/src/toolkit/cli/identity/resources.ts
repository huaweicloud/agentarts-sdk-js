/** identity CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { IdentityClient } from '../../../sdk/service/identity/identity-client.js';
import * as operations from '../../operations/identity/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const identityCommands: OperationCommand[] = [
  {
    name: 'create-workload-identity',
    method: 'createWorkloadIdentity',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: false },
      {
        key: 'allowedResourceOauth2ReturnUrls',
        flag: 'allowed-resource-oauth2-return-urls',
        kind: 'array',
        items: 'string',
        required: false,
      },
      { key: 'authorizerType', flag: 'authorizer-type', kind: 'string', required: false },
      {
        key: 'authorizerConfiguration',
        flag: 'authorizer-configuration',
        kind: 'object',
        required: false,
      },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createWorkloadIdentity(
        args as Parameters<IdentityClient['createWorkloadIdentity']>,
        options,
      ),
  },
  {
    name: 'update-workload-identity',
    method: 'updateWorkloadIdentity',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      {
        key: 'allowedResourceOauth2ReturnUrls',
        flag: 'allowed-resource-oauth2-return-urls',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'authorizerConfiguration',
        flag: 'authorizer-configuration',
        kind: 'object',
        required: false,
      },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.updateWorkloadIdentity(
        args as Parameters<IdentityClient['updateWorkloadIdentity']>,
        options,
      ),
  },
  {
    name: 'get-workload-identity',
    method: 'getWorkloadIdentity',
    fields: [{ key: 'name', flag: 'name', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getWorkloadIdentity(
        args as Parameters<IdentityClient['getWorkloadIdentity']>,
        options,
      ),
  },
  {
    name: 'list-workload-identities',
    method: 'listWorkloadIdentities',
    fields: [
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listWorkloadIdentities(
        args as Parameters<IdentityClient['listWorkloadIdentities']>,
        options,
      ),
  },
  {
    name: 'create-api-key-credential-provider',
    method: 'createApiKeyCredentialProvider',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createApiKeyCredentialProvider(
        args as Parameters<IdentityClient['createApiKeyCredentialProvider']>,
        options,
      ),
  },
  {
    name: 'create-oauth2-credential-provider',
    method: 'createOauth2CredentialProvider',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      { key: 'vendor', flag: 'vendor', kind: 'string', required: true },
      { key: 'clientId', flag: 'client-id', kind: 'string', required: true },
      { key: 'clientSecret', flag: 'client-secret', kind: 'string', required: true },
      { key: 'tenantId', flag: 'tenant-id', kind: 'string', required: false },
      { key: 'oauthDiscovery', flag: 'oauth-discovery', kind: 'object', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createOauth2CredentialProvider(
        args as Parameters<IdentityClient['createOauth2CredentialProvider']>,
        options,
      ),
  },
  {
    name: 'create-sts-credential-provider',
    method: 'createStsCredentialProvider',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      { key: 'agencyUrn', flag: 'agency-urn', kind: 'string', required: true },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createStsCredentialProvider(
        args as Parameters<IdentityClient['createStsCredentialProvider']>,
        options,
      ),
  },
  {
    name: 'create-workload-access-token',
    method: 'createWorkloadAccessToken',
    fields: [
      { key: 'workloadName', flag: 'workload-name', kind: 'string', required: true },
      { key: 'userToken', flag: 'user-token', kind: 'string', required: false },
      { key: 'userId', flag: 'user-id', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createWorkloadAccessToken(
        args as Parameters<IdentityClient['createWorkloadAccessToken']>,
        options,
      ),
  },
  {
    name: 'get-api-key-credential-provider',
    method: 'getApiKeyCredentialProvider',
    fields: [{ key: 'name', flag: 'name', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getApiKeyCredentialProvider(
        args as Parameters<IdentityClient['getApiKeyCredentialProvider']>,
        options,
      ),
  },
  {
    name: 'list-api-key-credential-providers',
    method: 'listApiKeyCredentialProviders',
    fields: [
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listApiKeyCredentialProviders(
        args as Parameters<IdentityClient['listApiKeyCredentialProviders']>,
        options,
      ),
  },
  {
    name: 'get-oauth2-credential-provider',
    method: 'getOauth2CredentialProvider',
    fields: [{ key: 'name', flag: 'name', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getOauth2CredentialProvider(
        args as Parameters<IdentityClient['getOauth2CredentialProvider']>,
        options,
      ),
  },
  {
    name: 'list-oauth2-credential-providers',
    method: 'listOauth2CredentialProviders',
    fields: [
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listOauth2CredentialProviders(
        args as Parameters<IdentityClient['listOauth2CredentialProviders']>,
        options,
      ),
  },
  {
    name: 'get-sts-credential-provider',
    method: 'getStsCredentialProvider',
    fields: [{ key: 'name', flag: 'name', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getStsCredentialProvider(
        args as Parameters<IdentityClient['getStsCredentialProvider']>,
        options,
      ),
  },
  {
    name: 'list-sts-credential-providers',
    method: 'listStsCredentialProviders',
    fields: [
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listStsCredentialProviders(
        args as Parameters<IdentityClient['listStsCredentialProviders']>,
        options,
      ),
  },
  {
    name: 'get-resource-oauth2-token',
    method: 'getResourceOauth2Token',
    fields: [{ key: 'options', flag: 'options', kind: 'object', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getResourceOauth2Token(
        args as Parameters<IdentityClient['getResourceOauth2Token']>,
        options,
      ),
  },
  {
    name: 'get-resource-api-key',
    method: 'getResourceApiKey',
    fields: [{ key: 'options', flag: 'options', kind: 'object', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getResourceApiKey(
        args as Parameters<IdentityClient['getResourceApiKey']>,
        options,
      ),
  },
  {
    name: 'get-resource-sts-token',
    method: 'getResourceStsToken',
    fields: [{ key: 'options', flag: 'options', kind: 'object', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getResourceStsToken(
        args as Parameters<IdentityClient['getResourceStsToken']>,
        options,
      ),
  },
  {
    name: 'complete-resource-token-auth',
    method: 'completeResourceTokenAuth',
    fields: [
      { key: 'sessionUri', flag: 'session-uri', kind: 'string', required: true },
      { key: 'userIdentifier', flag: 'user-identifier', kind: 'object', required: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.completeResourceTokenAuth(
        args as Parameters<IdentityClient['completeResourceTokenAuth']>,
        options,
      ),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, identityCommands, { region: true });
}

export function createResourceCommand(): Command {
  const command = new Command('identity').description('identity resource and session management');
  registerResourceCommands(command);
  return command;
}

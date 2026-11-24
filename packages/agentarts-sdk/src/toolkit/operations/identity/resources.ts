/** identity SDK business operations, returning structured results. */
import { IdentityClient } from '../../../sdk/service/identity/identity-client.js';
import {
  Oauth2Discovery,
  Oauth2AuthorizationServerMetadata,
  UserIdentifier,
} from '@huaweicloud/huaweicloud-sdk-agentidentity';
import { getRegion } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Operation counterpart of IdentityClient.createWorkloadIdentity. */
export function createWorkloadIdentity(
  args: Parameters<IdentityClient['createWorkloadIdentity']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.createWorkloadIdentity(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.updateWorkloadIdentity. */
export function updateWorkloadIdentity(
  args: Parameters<IdentityClient['updateWorkloadIdentity']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.updateWorkloadIdentity(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getWorkloadIdentity. */
export function getWorkloadIdentity(
  args: Parameters<IdentityClient['getWorkloadIdentity']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getWorkloadIdentity(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.listWorkloadIdentities. */
export function listWorkloadIdentities(
  args: Parameters<IdentityClient['listWorkloadIdentities']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.listWorkloadIdentities(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.createApiKeyCredentialProvider. */
export function createApiKeyCredentialProvider(
  args: Parameters<IdentityClient['createApiKeyCredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.createApiKeyCredentialProvider(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.createOauth2CredentialProvider. */
export function createOauth2CredentialProvider(
  args: Parameters<IdentityClient['createOauth2CredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const discovery = args[5];
      const converted =
        discovery == null
          ? discovery
          : new Oauth2Discovery({
              ...discovery,
              authorizationServerMetadata:
                discovery.authorizationServerMetadata == null
                  ? discovery.authorizationServerMetadata
                  : new Oauth2AuthorizationServerMetadata(discovery.authorizationServerMetadata),
            });
      const value = await client.createOauth2CredentialProvider(
        args[0],
        args[1],
        args[2],
        args[3],
        args[4],
        converted,
        args[6],
      );
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.createStsCredentialProvider. */
export function createStsCredentialProvider(
  args: Parameters<IdentityClient['createStsCredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.createStsCredentialProvider(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.createWorkloadAccessToken. */
export function createWorkloadAccessToken(
  args: Parameters<IdentityClient['createWorkloadAccessToken']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.createWorkloadAccessToken(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getApiKeyCredentialProvider. */
export function getApiKeyCredentialProvider(
  args: Parameters<IdentityClient['getApiKeyCredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getApiKeyCredentialProvider(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.listApiKeyCredentialProviders. */
export function listApiKeyCredentialProviders(
  args: Parameters<IdentityClient['listApiKeyCredentialProviders']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.listApiKeyCredentialProviders(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getOauth2CredentialProvider. */
export function getOauth2CredentialProvider(
  args: Parameters<IdentityClient['getOauth2CredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getOauth2CredentialProvider(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.listOauth2CredentialProviders. */
export function listOauth2CredentialProviders(
  args: Parameters<IdentityClient['listOauth2CredentialProviders']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.listOauth2CredentialProviders(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getStsCredentialProvider. */
export function getStsCredentialProvider(
  args: Parameters<IdentityClient['getStsCredentialProvider']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getStsCredentialProvider(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.listStsCredentialProviders. */
export function listStsCredentialProviders(
  args: Parameters<IdentityClient['listStsCredentialProviders']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.listStsCredentialProviders(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getResourceOauth2Token. */
export function getResourceOauth2Token(
  args: Parameters<IdentityClient['getResourceOauth2Token']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      if (args[0]) {
        const input = args[0] as any;
        args = [{ ...input, onAuthUrl: options.onAuthUrl ?? input.onAuthUrl }] as Parameters<
          IdentityClient['getResourceOauth2Token']
        >;
      }
      const value = await client.getResourceOauth2Token(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getResourceApiKey. */
export function getResourceApiKey(
  args: Parameters<IdentityClient['getResourceApiKey']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getResourceApiKey(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.getResourceStsToken. */
export function getResourceStsToken(
  args: Parameters<IdentityClient['getResourceStsToken']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.getResourceStsToken(...args);
      return value;
    },
  );
}

/** Operation counterpart of IdentityClient.completeResourceTokenAuth. */
export function completeResourceTokenAuth(
  args: Parameters<IdentityClient['completeResourceTokenAuth']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IdentityClient(options.region ?? getRegion(), options.skipSslVerification),
    async (client) => {
      const value = await client.completeResourceTokenAuth(args[0], new UserIdentifier(args[1]));
      return value;
    },
  );
}

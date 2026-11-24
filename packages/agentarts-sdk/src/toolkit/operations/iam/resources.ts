/** iam SDK business operations, returning structured results. */
import { IAMClient } from '../../../sdk/service/iam-client.js';
import { getRegion, getControlPlaneEndpoint } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Operation counterpart of IAMClient.createAgency. */
export function createAgency(
  args: Parameters<IAMClient['createAgency']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IAMClient(!options.skipSslVerification),
    async (client) => {
      const value = await client.createAgency(...args);
      return value;
    },
  );
}

/** Operation counterpart of IAMClient.listPolicies. */
export function listPolicies(
  args: Parameters<IAMClient['listPolicies']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IAMClient(!options.skipSslVerification),
    async (client) => {
      const value = await client.listPolicies(...args);
      return value;
    },
  );
}

/** Operation counterpart of IAMClient.listAgencies. */
export function listAgencies(
  args: Parameters<IAMClient['listAgencies']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IAMClient(!options.skipSslVerification),
    async (client) => {
      const value = await client.listAgencies(...args);
      return value;
    },
  );
}

/** Operation counterpart of IAMClient.attachAgencyPolicy. */
export function attachAgencyPolicy(
  args: Parameters<IAMClient['attachAgencyPolicy']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IAMClient(!options.skipSslVerification),
    async (client) => {
      const value = await client.attachAgencyPolicy(...args);
      return value;
    },
  );
}

/** Operation counterpart of IAMClient.createAgencyWithPolicy. */
export function createAgencyWithPolicy(
  args: Parameters<IAMClient['createAgencyWithPolicy']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () => new IAMClient(!options.skipSslVerification),
    async (client) => {
      const value = await client.createAgencyWithPolicy(...args);
      return value;
    },
  );
}

/** swr SDK business operations, returning structured results. */
import { SWRClient } from '../../../sdk/service/swr-client.js';
import { getRegion, getControlPlaneEndpoint } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Operation counterpart of SWRClient.getOrganization. */
export function getOrganization(
  args: Parameters<SWRClient['getOrganization']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getOrganization(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.createOrganization. */
export function createOrganization(
  args: Parameters<SWRClient['createOrganization']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createOrganization(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.createOrGetOrganization. */
export function createOrGetOrganization(
  args: Parameters<SWRClient['createOrGetOrganization']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createOrGetOrganization(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.getRepository. */
export function getRepository(
  args: Parameters<SWRClient['getRepository']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getRepository(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.createRepository. */
export function createRepository(
  args: Parameters<SWRClient['createRepository']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createRepository(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.createOrGetRepository. */
export function createOrGetRepository(
  args: Parameters<SWRClient['createOrGetRepository']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createOrGetRepository(...args);
      if (value === null)
        throw new Error('SWR operation returned no resource; inspect SDK error output');
      return value;
    },
  );
}

/** Operation counterpart of SWRClient.createSwrSecret. */
export function createSwrSecret(
  args: Parameters<SWRClient['createSwrSecret']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new SWRClient(
        options.region ?? getRegion(),
        options.dataEndpoint,
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createSwrSecret(...args);
      if (!value[1] || !value[2]) throw new Error('SWR did not return valid login credentials');
      return value;
    },
  );
}

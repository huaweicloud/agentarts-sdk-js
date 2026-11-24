/** runtime SDK business operations, returning structured results. */
import { RuntimeClient, LocalRuntimeClient } from '../../../sdk/service/runtime-client.js';
import { getRegion, getControlPlaneEndpoint } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Local runtime health check; existing invoke command already supports local invocation. */
export function pingAgent(
  args: [
    port?: number,
    host?: string,
    timeout?: number,
    options?: Parameters<LocalRuntimeClient['pingAgent']>[0],
  ],
) {
  return executeOperation(
    () => new LocalRuntimeClient(args[0], args[1], args[2]),
    (client) => client.pingAgent(args[3]),
  );
}

/** Operation counterpart of RuntimeClient.createAgent. */
export function createAgent(
  args: Parameters<RuntimeClient['createAgent']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.createAgent(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.updateAgent. */
export function updateAgent(
  args: Parameters<RuntimeClient['updateAgent']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.updateAgent(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.createOrUpdateAgent. */
export function createOrUpdateAgent(
  args: Parameters<RuntimeClient['createOrUpdateAgent']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.createOrUpdateAgent(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.getAgents. */
export function getAgents(
  args: Parameters<RuntimeClient['getAgents']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.getAgents(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.findAgentByName. */
export function findAgentByName(
  args: Parameters<RuntimeClient['findAgentByName']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.findAgentByName(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.findAgentById. */
export function findAgentById(
  args: Parameters<RuntimeClient['findAgentById']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.findAgentById(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.deleteAgentByName. */
export function deleteAgentByName(
  args: Parameters<RuntimeClient['deleteAgentByName']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.deleteAgentByName(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.createAgentEndpoint. */
export function createAgentEndpoint(
  args: Parameters<RuntimeClient['createAgentEndpoint']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.createAgentEndpoint(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.updateAgentEndpoint. */
export function updateAgentEndpoint(
  args: Parameters<RuntimeClient['updateAgentEndpoint']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.updateAgentEndpoint(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.deleteAgentEndpoint. */
export function deleteAgentEndpoint(
  args: Parameters<RuntimeClient['deleteAgentEndpoint']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.deleteAgentEndpoint(...args);
      return value;
    },
  );
}

/** Operation counterpart of RuntimeClient.findAgentEndpoint. */
export function findAgentEndpoint(
  args: Parameters<RuntimeClient['findAgentEndpoint']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new RuntimeClient({
        controlEndpoint: getControlPlaneEndpoint(options.region),
        verifySsl: !options.skipSslVerification,
      }),
    async (client) => {
      const value = await client.findAgentEndpoint(...args);
      return value;
    },
  );
}

/** Gateway operations shared by CLI and toolkit consumers. */
import { GatewayClient } from '../../../sdk/gateway/index.js';
import { executeOperation } from '../common.js';

export function createGateway(args: Parameters<GatewayClient['createGateway']>, verifySsl = true) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.createGateway(...args),
    (client) => client.close(),
  );
}

export function updateGateway(args: Parameters<GatewayClient['updateGateway']>, verifySsl = true) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.updateGateway(...args),
    (client) => client.close(),
  );
}

export function deleteGateway(args: Parameters<GatewayClient['deleteGateway']>, verifySsl = true) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.deleteGateway(...args),
    (client) => client.close(),
  );
}

export function getGateway(args: Parameters<GatewayClient['getGateway']>, verifySsl = true) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.getGateway(...args),
    (client) => client.close(),
  );
}

export function listGateways(args: Parameters<GatewayClient['listGateways']>, verifySsl = true) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.listGateways(...args),
    (client) => client.close(),
  );
}

export function createGatewayTarget(
  args: Parameters<GatewayClient['createGatewayTarget']>,
  verifySsl = true,
) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.createGatewayTarget(...args),
    (client) => client.close(),
  );
}

export function updateGatewayTarget(
  args: Parameters<GatewayClient['updateGatewayTarget']>,
  verifySsl = true,
) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.updateGatewayTarget(...args),
    (client) => client.close(),
  );
}

export function deleteGatewayTarget(
  args: Parameters<GatewayClient['deleteGatewayTarget']>,
  verifySsl = true,
) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.deleteGatewayTarget(...args),
    (client) => client.close(),
  );
}

export function getGatewayTarget(
  args: Parameters<GatewayClient['getGatewayTarget']>,
  verifySsl = true,
) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.getGatewayTarget(...args),
    (client) => client.close(),
  );
}

export function listGatewayTargets(
  args: Parameters<GatewayClient['listGatewayTargets']>,
  verifySsl = true,
) {
  return executeOperation(
    () => new GatewayClient(verifySsl),
    (client) => client.listGatewayTargets(...args),
    (client) => client.close(),
  );
}

/** Preserve the existing Gateway CLI argument order while delegating every call. */
export function createGatewayOperations(verifySsl = true) {
  return {
    createGateway: (...args: Parameters<GatewayClient['createGateway']>) =>
      createGateway(args, verifySsl),
    updateGateway: (...args: Parameters<GatewayClient['updateGateway']>) =>
      updateGateway(args, verifySsl),
    deleteGateway: (...args: Parameters<GatewayClient['deleteGateway']>) =>
      deleteGateway(args, verifySsl),
    getGateway: (...args: Parameters<GatewayClient['getGateway']>) => getGateway(args, verifySsl),
    listGateways: (...args: Parameters<GatewayClient['listGateways']>) =>
      listGateways(args, verifySsl),
    createGatewayTarget: (...args: Parameters<GatewayClient['createGatewayTarget']>) =>
      createGatewayTarget(args, verifySsl),
    updateGatewayTarget: (...args: Parameters<GatewayClient['updateGatewayTarget']>) =>
      updateGatewayTarget(args, verifySsl),
    deleteGatewayTarget: (...args: Parameters<GatewayClient['deleteGatewayTarget']>) =>
      deleteGatewayTarget(args, verifySsl),
    getGatewayTarget: (...args: Parameters<GatewayClient['getGatewayTarget']>) =>
      getGatewayTarget(args, verifySsl),
    listGatewayTargets: (...args: Parameters<GatewayClient['listGatewayTargets']>) =>
      listGatewayTargets(args, verifySsl),
  };
}

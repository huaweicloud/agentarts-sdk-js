/** code-interpreter SDK business operations, returning structured results. */
import { CodeInterpreter } from '../../../sdk/tools/code_interpreter/code-interpreter-client.js';
import { getRegion, getControlPlaneEndpoint } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Operation counterpart of CodeInterpreter.createCodeInterpreter. */
export function createCodeInterpreter(
  args: Parameters<CodeInterpreter['createCodeInterpreter']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createCodeInterpreter(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.listCodeInterpreters. */
export function listCodeInterpreters(
  args: Parameters<CodeInterpreter['listCodeInterpreters']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.listCodeInterpreters(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.updateCodeInterpreter. */
export function updateCodeInterpreter(
  args: Parameters<CodeInterpreter['updateCodeInterpreter']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.updateCodeInterpreter(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.getCodeInterpreter. */
export function getCodeInterpreter(
  args: Parameters<CodeInterpreter['getCodeInterpreter']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getCodeInterpreter(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.deleteCodeInterpreter. */
export function deleteCodeInterpreter(
  args: Parameters<CodeInterpreter['deleteCodeInterpreter']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.deleteCodeInterpreter(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.startSession. */
export function startSession(
  args: Parameters<CodeInterpreter['startSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.startSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.getSession. */
export function getSession(
  args: Parameters<CodeInterpreter['getSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.stopSession. */
export function stopSession(
  args: Parameters<CodeInterpreter['stopSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.stopSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.invoke. */
export function invoke(
  args: Parameters<CodeInterpreter['invoke']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.invoke(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.executeCode. */
export function executeCode(
  args: Parameters<CodeInterpreter['executeCode']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.executeCode(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.executeCommand. */
export function executeCommand(
  args: Parameters<CodeInterpreter['executeCommand']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.executeCommand(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.uploadFile. */
export function uploadFile(
  args: Parameters<CodeInterpreter['uploadFile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.uploadFile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.uploadFiles. */
export function uploadFiles(
  args: Parameters<CodeInterpreter['uploadFiles']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.uploadFiles(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.downloadFile. */
export function downloadFile(
  args: Parameters<CodeInterpreter['downloadFile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.downloadFile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.downloadFiles. */
export function downloadFiles(
  args: Parameters<CodeInterpreter['downloadFiles']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.downloadFiles(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.installPackages. */
export function installPackages(
  args: Parameters<CodeInterpreter['installPackages']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.installPackages(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of CodeInterpreter.clearContext. */
export function clearContext(
  args: Parameters<CodeInterpreter['clearContext']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new CodeInterpreter(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.codeInterpreterName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.clearContext(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client.dataPlaneClient.close();
    },
  );
}

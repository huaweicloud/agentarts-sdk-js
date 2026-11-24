/**
 * AgentArts Operations - Runtime.
 *
 * Core implementation logic for runtime operations. Mirrors
 * `agentarts/toolkit/operations/runtime/__init__.py`: the Python package
 * re-exports the config helpers plus the deploy/dev/init/invoke entry points;
 * the remaining operations (`destroy`, `download-files`, `exec-command`,
 * `start-session`, `stop-session`, `upload-files`) are imported directly by the
 * CLI in Python and are re-exported here as well for convenience.
 */

export { DeployMode, createAgentartsRuntime, deployProject } from './deploy.js';
export type { CreateAgentartsRuntimeOptions, DeployProjectOptions } from './deploy.js';

export { runDevServer } from './dev.js';
export type { RunDevServerOptions } from './dev.js';

export { initProject } from './init.js';
export type { InitProjectOptions, TemplateEnvVar } from './init.js';

export { InvokeMode, invokeAgent } from './invoke.js';
export type { InvokeAgentOptions } from './invoke.js';

export { startRuntimeSession } from './start-session.js';
export type { StartRuntimeSessionOptions } from './start-session.js';

export { ValidationError } from './errors.js';

export {
  CONFIG_FILE_NAME,
  addAgent,
  console,
  defaultBaseImage,
  detectDependencyFile,
  detectPlatform,
  ensureConfigExists,
  generateDockerfile,
  getAgent,
  getConfigFilePath,
  getConfigValue,
  getDefaultAgent,
  inferLanguage,
  listAgents,
  listEnv,
  loadConfig,
  printAgentDetail,
  printConfigList,
  removeAgent,
  removeEnv,
  saveConfig,
  setConfigValue,
  setDefaultAgent,
  setEnv,
} from './config.js';
export type { AddAgentOptions, GenerateDockerfileOptions } from './config.js';

export { destroyAgent } from './destroy.js';
export type { DestroyAgentOptions } from './destroy.js';

export { downloadRuntimeFiles } from './download-files.js';
export type { DownloadRuntimeFilesOptions } from './download-files.js';

export {
  DEFAULT_TIMEOUT,
  MAX_TIMEOUT,
  buildCommandArray,
  execRuntimeCommand,
} from './exec-command.js';
export type { ExecRuntimeCommandOptions } from './exec-command.js';

export { stopRuntimeSession } from './stop-session.js';
export type { StopRuntimeSessionOptions } from './stop-session.js';

export {
  DEFAULT_FILE_GROUP_ID,
  DEFAULT_FILE_MODE,
  DEFAULT_FILE_USER_ID,
  uploadRuntimeFiles,
} from './upload-files.js';
export type { UploadRuntimeFilesOptions } from './upload-files.js';

export {
  createAgent,
  updateAgent,
  createOrUpdateAgent,
  getAgents,
  findAgentByName,
  findAgentById,
  deleteAgentByName,
  createAgentEndpoint,
  updateAgentEndpoint,
  deleteAgentEndpoint,
  findAgentEndpoint,
  pingAgent,
} from './resources.js';

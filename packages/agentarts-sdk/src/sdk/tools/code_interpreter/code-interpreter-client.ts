/**
 * Client for interacting with the Code Interpreter sandbox service.
 *
 * Mirrors `agentarts/sdk/tools/code_interpreter/code_interpreter_client.py`.
 * Supports starting, stopping, and invoking code in a managed sandbox
 * environment.
 *
 * Control Plane:
 *     Manages the full lifecycle of code interpreters
 *     (create, list, update, get, delete)
 *
 * Data Plane:
 *     Manages the full lifecycle of code interpreter sessions
 *     (create, stop, get, invoke)
 */

import { posix } from 'node:path';
import { TextDecoder } from 'node:util';

import { ControlToolsHttpClient, DataToolsHttpClient } from '../../service/tools-http.js';
import {
  getCodeInterpreterDataPlaneEndpoint,
  getControlPlaneEndpoint,
  getRegion,
} from '../../utils/constant.js';
import { getLogger } from '../../utils/logging.js';

const logger = getLogger('sdk.tools.code_interpreter.code_interpreter_client');

/** Default session timeout: 15 minutes. */
export const DEFAULT_TIMEOUT = 900;
/** Default path; currently only upload/download under this path is supported. */
export const DEFAULT_PATH = '/home/user';

/**
 * Languages accepted by the Code Interpreter data plane (`execute_code`).
 *
 * The sandbox runs Python and TypeScript. `javascript` is **not** accepted by
 * the service (it rejects it with `Unsupported language: javascript`), even
 * though Node.js 20 is available for {@link CodeInterpreter.executeCommand}.
 */
export const SUPPORTED_CODE_LANGUAGES = ['python', 'typescript'] as const;

/** A language value accepted by {@link CodeInterpreter.executeCode}. */
export type CodeLanguage = (typeof SUPPORTED_CODE_LANGUAGES)[number];

const ENV_HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY = 'HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY';

/** Default session name used by {@link codeSession}, same as Python. */
const DEFAULT_SESSION_NAME = 'default-session-name';

/** File specification accepted by {@link CodeInterpreter.uploadFiles}. */
export interface UploadFileSpec {
  path?: string;
  content?: string | Uint8Array | null;
  description?: string;
}

/** Drop `undefined`/`null` values, mirroring Python's dict-comprehension filtering. */
function _withoutNone(params: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }
  return result;
}

/** Normalize an upload path the same way Python's `os.path` does on a POSIX host. */
function _resolveUploadPath(path: string): string {
  if (!path.startsWith('/')) {
    return posix.join(DEFAULT_PATH, posix.normalize(path));
  }
  if (!path.startsWith(DEFAULT_PATH)) {
    throw new Error(`Invalid path. Path must start with ${DEFAULT_PATH}`);
  }
  return path;
}

/** Build a wire file entry (`text` for strings, base64 `blob` for binary). */
function _buildFileContent(path: string, content?: string | Uint8Array | null): Record<string, any> {
  if (content instanceof Uint8Array) {
    return { path, blob: Buffer.from(content).toString('base64') };
  }
  return { path, text: content ?? null };
}

/** Decode UTF-8, falling back to raw bytes — mirrors Python's try/except decode. */
function _decodeTextOrBytes(raw: Buffer): string | Buffer {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return raw;
  }
}

/**
 * Client for interacting with the Code Interpreter sandbox service.
 *
 * This client handles the full lifecycle and method invocations for code
 * interpreter sandbox sessions, providing interfaces for executing code,
 * uploading/downloading files, installing dependencies, and more in a secure,
 * managed environment.
 */
export class CodeInterpreter {
  /** Client for interacting with control plane API. */
  readonly controlPlaneClient: ControlToolsHttpClient;
  /** Client for interacting with data plane API. */
  readonly dataPlaneClient: DataToolsHttpClient;

  private _codeInterpreterName: string | null = null;
  private _sessionId: string | null = null;

  /**
   * Initialize the code interpreter client in the specified region.
   *
   * @param region The specified region. Falls back to the region resolved from
   *   environment variables when `null`.
   * @param dataEndpoint Data plane endpoint, optional. If not provided, it is
   *   retrieved from environment variable `AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT`.
   * @param authType Authentication type, optional. Defaults to `"API_KEY"`.
   * @param verifySsl SSL verification setting, optional. Defaults to `true`.
   *   When a string, it is used as the CA bundle path.
   */
  constructor(
    region: string | null,
    dataEndpoint: string | null = null,
    authType = 'API_KEY',
    verifySsl: boolean | string = true,
  ) {
    const effectiveRegion = region || getRegion();

    // Control plane client for managing code interpreters.
    this.controlPlaneClient = new ControlToolsHttpClient(
      effectiveRegion,
      getControlPlaneEndpoint(effectiveRegion),
      verifySsl,
    );

    // Data plane client for managing code interpreter sessions.
    // Priority: environment variable > parameter > default value.
    const endpointUrl = getCodeInterpreterDataPlaneEndpoint(dataEndpoint);

    if (authType === 'IAM') {
      this.dataPlaneClient = new DataToolsHttpClient(
        effectiveRegion,
        endpointUrl,
        authType,
        verifySsl,
      );
    } else {
      this.dataPlaneClient = new DataToolsHttpClient(effectiveRegion, endpointUrl, 'API_KEY', verifySsl);
    }
  }

  /** Get the current code interpreter name, or `null` if not set. */
  get codeInterpreterName(): string | null {
    return this._codeInterpreterName;
  }

  /** Set the current code interpreter name. */
  set codeInterpreterName(name: string | null) {
    this._codeInterpreterName = name;
  }

  /** Get the current session ID, or `null` if not set. */
  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Set the current session ID. */
  set sessionId(sessionId: string | null) {
    this._sessionId = sessionId;
  }

  /**
   * Create a custom code interpreter through the control plane.
   *
   * @param name Code interpreter name, must follow the naming rules
   *   (`^[a-z][a-z0-9-]{0,38}[a-z0-9]$`).
   * @param authType Authentication type: `"API_KEY"` or `"IAM"`. Defaults to `"API_KEY"`.
   * @param apiKeyName API Key name (required when `authType` is `"API_KEY"`).
   * @param description Code interpreter description.
   * @param executionAgencyName IAM agency name.
   * @param observability Observability configuration (logging and monitoring).
   * @param networkConfig Network configuration (VPC and security groups).
   * @param agentGatewayId Associated Agent Gateway ID.
   * @param tags Tag list, each tag contains `key` and `value`.
   */
  async createCodeInterpreter(
    name: string,
    authType = 'API_KEY',
    apiKeyName: string | null = null,
    description: string | null = null,
    executionAgencyName: string | null = null,
    observability: Record<string, any> | null = null,
    networkConfig: Record<string, any> | null = null,
    agentGatewayId: string | null = null,
    tags: Array<Record<string, any>> | null = null,
  ): Promise<Record<string, any>> {
    logger.info(`Creating code interpreter with name: ${name}`);
    const pattern = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;
    if (!pattern.test(name)) {
      throw new Error(
        'Name must start with lowercase letter, end with lowercase letter or digit, ' +
          'contain only lowercase letters, digits, and hyphens, and be 2-40 characters long.',
      );
    }
    if (authType === 'API_KEY' && apiKeyName === null) {
      throw new Error('API_KEY auth_type requires api_key_name.');
    }

    const requestParams: Record<string, any> = { name, auth_type: authType };

    if (apiKeyName) {
      requestParams['api_key_name'] = apiKeyName;
    }
    if (description) {
      requestParams['description'] = description;
    }
    if (executionAgencyName) {
      requestParams['execution_agency_name'] = executionAgencyName;
    }
    if (observability) {
      requestParams['observability'] = observability;
    }
    if (networkConfig) {
      requestParams['network_config'] = networkConfig;
    }
    if (agentGatewayId) {
      requestParams['agent_gateway_id'] = agentGatewayId;
    }
    if (tags) {
      requestParams['tags'] = tags;
    }

    return this.controlPlaneClient.createCodeInterpreter(requestParams);
  }

  /**
   * List code interpreters with optional filters and pagination.
   *
   * @param name Fuzzy search by name (2-40 characters).
   * @param limit Number of code interpreters per page, default 10.
   * @param offset Pagination offset, default 0.
   * @param sortKey Sort field: `"created_at"` or `"updated_at"`.
   * @param sortDir Sort direction: `"asc"` or `"desc"`.
   * @param tagKeyExists Filter by tag keys, max 10 items.
   * @param tagKeyMatches Tag keys to match, must pair with `tagValueMatches`.
   * @param tagValueMatches Tag values to match, must pair with `tagKeyMatches`.
   * @param tagMatchPolicy Tag matching policy: `"ALL"` or `"ANY"`, default `"ALL"`.
   */
  async listCodeInterpreters(
    name: string | null = null,
    limit = 10,
    offset = 0,
    sortKey: string | null = null,
    sortDir: string | null = null,
    tagKeyExists: string[] | null = null,
    tagKeyMatches: string[] | null = null,
    tagValueMatches: string[] | null = null,
    tagMatchPolicy: string | null = null,
  ): Promise<Record<string, any>> {
    logger.info('Listing code interpreters');

    // Convert empty lists to null for consistent handling.
    tagKeyExists = tagKeyExists && tagKeyExists.length > 0 ? tagKeyExists : null;
    tagKeyMatches = tagKeyMatches && tagKeyMatches.length > 0 ? tagKeyMatches : null;
    tagValueMatches = tagValueMatches && tagValueMatches.length > 0 ? tagValueMatches : null;

    // Parameter validation.
    if (name != null && (name.length < 2 || name.length > 40)) {
      throw new Error('name must be between 2 and 40 characters');
    }

    if (sortKey && !['created_at', 'updated_at'].includes(sortKey)) {
      throw new Error("sort_key must be either 'created_at' or 'updated_at'");
    }
    if (sortDir && !['asc', 'desc'].includes(sortDir)) {
      throw new Error("sort_dir must be either 'asc' or 'desc'");
    }
    if (tagMatchPolicy && !['ALL', 'ANY'].includes(tagMatchPolicy)) {
      throw new Error("tag_match_policy must be either 'ALL' or 'ANY'");
    }

    if (tagKeyExists) {
      if (tagKeyExists.length > 10) {
        throw new Error('tag_key_exists supports up to 10 items');
      }
      if (tagKeyExists.length !== new Set(tagKeyExists).size) {
        throw new Error('tag_key_exists must not contain duplicate items');
      }
      for (const key of tagKeyExists) {
        if (key.length > 128) {
          throw new Error('tag_key must not exceed 128 characters');
        }
      }
    }

    if (tagKeyMatches || tagValueMatches) {
      if (!tagKeyMatches || !tagValueMatches) {
        throw new Error('tag_key_matches and tag_value_matches must be used together');
      }
      if (tagKeyMatches.length !== tagValueMatches.length) {
        throw new Error('tag_key_matches and tag_value_matches must have the same length');
      }
      if (tagKeyMatches.length > 10) {
        throw new Error('tag_key_matches supports up to 10 items');
      }
      if (tagKeyMatches.length !== new Set(tagKeyMatches).size) {
        throw new Error('tag_key_matches must not contain duplicate items');
      }
      if (tagValueMatches.length !== new Set(tagValueMatches).size) {
        throw new Error('tag_value_matches must not contain duplicate items');
      }
      if (tagKeyMatches.includes('')) {
        throw new Error('tag_key_matches does not support empty strings');
      }
      const seenPairs = new Set(
        tagKeyMatches.map((key, index) => `${key}\u0000${tagValueMatches[index]}`),
      );
      if (seenPairs.size !== tagKeyMatches.length) {
        throw new Error('tag_key_matches and tag_value_matches must have unique key-value pairs');
      }
      for (const key of tagKeyMatches) {
        if (key.length > 128) {
          throw new Error('tag_key must not exceed 128 characters');
        }
      }
      for (const value of tagValueMatches) {
        if (value.length > 255) {
          throw new Error('tag_value must not exceed 255 characters');
        }
      }
    }

    const requestParams = _withoutNone({
      name,
      limit,
      offset,
      sort_key: sortKey,
      sort_dir: sortDir,
      tag_key_exists: tagKeyExists,
      tag_key_matches: tagKeyMatches,
      tag_value_matches: tagValueMatches,
      tag_match_policy: tagMatchPolicy,
    });

    return this.controlPlaneClient.listCodeInterpreters(requestParams);
  }

  /**
   * Update code interpreter observability configuration and tags.
   *
   * @param codeInterpreterId The code interpreter ID.
   * @param observability Observability configuration (logs + metrics), optional.
   * @param tags Tag list, each tag contains `key` and `value`, optional.
   */
  async updateCodeInterpreter(
    codeInterpreterId: string,
    observability: Record<string, any> | null = null,
    tags: Array<Record<string, any>> | null = null,
  ): Promise<Record<string, any>> {
    logger.info(`Updating code interpreter with ${codeInterpreterId}`);
    const requestParams: Record<string, any> = {};
    if (observability != null) {
      requestParams['observability'] = observability;
    }
    if (tags != null) {
      requestParams['tags'] = tags;
    }
    return this.controlPlaneClient.updateCodeInterpreter(codeInterpreterId, requestParams);
  }

  /** Get code interpreter details. */
  async getCodeInterpreter(codeInterpreterId: string): Promise<Record<string, any>> {
    logger.info(`Getting code interpreter ${codeInterpreterId}`);
    return this.controlPlaneClient.getCodeInterpreter(codeInterpreterId);
  }

  /** Delete a specified code interpreter. */
  async deleteCodeInterpreter(codeInterpreterId: string): Promise<void> {
    logger.info(`Deleting code interpreter ${codeInterpreterId}`);
    await this.controlPlaneClient.deleteCodeInterpreter(codeInterpreterId);
  }

  /**
   * Start a code interpreter session and return the session ID.
   *
   * @param codeInterpreterName The code interpreter name (unique).
   * @param sessionName The session name.
   * @param apiKey API Key for authentication, used only when auth type is
   *   `"API_KEY"`; read from environment variable
   *   `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY` when not provided.
   * @param sessionTimeout Session timeout in seconds; 60-86400. Defaults to 900.
   */
  async startSession(
    codeInterpreterName: string,
    sessionName: string,
    apiKey: string | null = null,
    sessionTimeout: number | null = DEFAULT_TIMEOUT,
  ): Promise<string> {
    logger.info('Starting codeinterpreter session...');
    const requestParams: Record<string, any> = {
      name: sessionName,
      session_timeout: sessionTimeout,
    };

    let response: Record<string, any>;
    if (this.dataPlaneClient.openAkSk) {
      response = await this.dataPlaneClient.startSession(codeInterpreterName, requestParams);
    } else {
      // Default to API_KEY authentication.
      const resolvedApiKey =
        apiKey || process.env[ENV_HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY];
      if (!resolvedApiKey) {
        throw new Error('API Key is not provided and not found in environment variable.');
      }
      response = await this.dataPlaneClient.startSession(
        codeInterpreterName,
        requestParams,
        resolvedApiKey,
      );
    }

    this.sessionId = response['session_id'] as string;
    this.codeInterpreterName = codeInterpreterName;
    return this.sessionId;
  }

  /**
   * Get code interpreter session details.
   *
   * @param codeInterpreterName The code interpreter name (unique).
   * @param sessionId The session ID, defaults to the current session ID.
   * @param apiKey API Key for authentication (API_KEY mode).
   */
  async getSession(
    codeInterpreterName: string,
    sessionId: string | null = null,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    logger.info('Getting codeinterpreter session...');

    const resolvedSessionId = sessionId || this.sessionId;
    if (!codeInterpreterName || !resolvedSessionId) {
      throw new Error('code_interpreter_name and session_id are required');
    }

    if (this.dataPlaneClient.openAkSk) {
      return this.dataPlaneClient.getSession(codeInterpreterName, resolvedSessionId);
    }

    // Default to API_KEY authentication.
    const resolvedApiKey = apiKey || process.env[ENV_HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY];
    if (!resolvedApiKey) {
      throw new Error('API Key is not provided and not found in environment variable.');
    }
    return this.dataPlaneClient.getSession(codeInterpreterName, resolvedSessionId, resolvedApiKey);
  }

  /**
   * Stop the current code interpreter session.
   *
   * @returns `true` when there is no active session, otherwise `true` after
   *   stopping (mirrors Python's return value).
   */
  async stopSession(apiKey: string | null = null): Promise<boolean> {
    logger.info('Stopping codeinterpreter session...');
    if (!this.sessionId || !this.codeInterpreterName) {
      return true;
    }

    if (this.dataPlaneClient.openAkSk) {
      await this.dataPlaneClient.stopSession(this.codeInterpreterName, this.sessionId);
    } else {
      // Default to API_KEY authentication.
      const resolvedApiKey = apiKey || process.env[ENV_HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY];
      if (!resolvedApiKey) {
        throw new Error('API Key is not provided and not found in environment variable.');
      }
      await this.dataPlaneClient.stopSession(this.codeInterpreterName, this.sessionId, resolvedApiKey);
    }

    this.codeInterpreterName = null;
    this.sessionId = null;
    return true;
  }

  /**
   * Invoke a code interpreter session.
   *
   * @param operateType The operation method name, e.g. `"execute_code"` or
   *   `"execute_command"`.
   * @param arguments_ Invocation arguments (Python's `arguments`); varies with
   *   `operateType`.
   * @param apiKey API Key for authentication (API_KEY mode).
   */
  async invoke(
    operateType: string,
    arguments_: Record<string, any>,
    apiKey: string | null = null,
  ): Promise<Record<string, any>> {
    if (!this.sessionId || !this.codeInterpreterName) {
      throw new Error('No Code Interpreter exists, use create_code_interpreter method first');
    }

    const requestParams = { operate_type: operateType, arguments: arguments_ };

    if (this.dataPlaneClient.openAkSk) {
      return this.dataPlaneClient.invoke(this.codeInterpreterName, this.sessionId, requestParams);
    }
    // Default to API_KEY authentication.
    const resolvedApiKey = apiKey || process.env[ENV_HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY];
    if (!resolvedApiKey) {
      throw new Error('API Key is not provided and not found in environment variable.');
    }
    return this.dataPlaneClient.invoke(
      this.codeInterpreterName,
      this.sessionId,
      requestParams,
      resolvedApiKey,
    );
  }

  /**
   * Execute code in the code interpreter.
   *
   * @param code The code to execute.
   * @param language The programming language: `"python"` (default) or
   *   `"typescript"`. The sandbox executes TypeScript natively; `"javascript"`
   *   is rejected by the service — see {@link SUPPORTED_CODE_LANGUAGES}.
   * @param clearContext Whether to clear context before execution, default `false`.
   * @returns Dictionary containing stdout, stderr, and exit_code information.
   */
  async executeCode(
    code: string,
    language = 'python',
    clearContext = false,
  ): Promise<Record<string, any>> {
    if (!SUPPORTED_CODE_LANGUAGES.includes(language as CodeLanguage)) {
      throw new Error(
        `Invalid language. Supported languages are: ${SUPPORTED_CODE_LANGUAGES.join(', ')}`,
      );
    }

    logger.info(`Executing ${language} code`);

    return this.invoke('execute_code', {
      code,
      language,
      clear_context: clearContext,
    });
  }

  /** Execute a command in the code interpreter. */
  async executeCommand(command: string): Promise<Record<string, any>> {
    // Define allowed safe characters.
    const pattern = /^[a-zA-Z0-9_\-.=\s/:]+$/;
    if (!pattern.test(command)) {
      throw new Error('Invalid command format');
    }

    // Check for common injection patterns (kept empty for parity with Python).
    const strictBlockPattrns: RegExp[] = [];

    for (const blockPattern of strictBlockPattrns) {
      if (blockPattern.test(command)) {
        throw new Error('Command contains potentially dangerous patterns');
      }
    }

    logger.info(`Executing command: ${command}`);

    return this.invoke('execute_command', { command });
  }

  /**
   * Upload a file to the code interpreter.
   *
   * @param path File path; relative paths are resolved under `/home/user`.
   * @param content File content; strings are sent as text, binary content is
   *   Base64 encoded.
   * @param description File description (useful for LLM understanding).
   */
  async uploadFile(
    path: string,
    content: string | Uint8Array,
    description = '',
  ): Promise<Record<string, any>> {
    const resolvedPath = _resolveUploadPath(path);
    const fileContent = _buildFileContent(resolvedPath, content);

    if (description) {
      logger.info(`Uploading file to ${resolvedPath} with description: ${description}`);
    } else {
      logger.info(`Uploading file to ${resolvedPath} without description`);
    }

    return this.invoke('write_files', { write_contents: [fileContent] });
  }

  /**
   * Upload multiple files to the code interpreter.
   *
   * The operation is atomic: all files are uploaded successfully or fail
   * together, no partial uploads.
   *
   * @param files List of file specifications (`path`, `content`, `description`).
   */
  async uploadFiles(files: UploadFileSpec[]): Promise<Record<string, any>> {
    const fileContents: Array<Record<string, any>> = [];
    for (const fileSpec of files) {
      const resolvedPath = _resolveUploadPath(fileSpec.path ?? '');
      fileContents.push(_buildFileContent(resolvedPath, fileSpec.content));
    }

    logger.info(`Uploading ${fileContents.length} files`);

    return this.invoke('write_files', { write_contents: fileContents });
  }

  /**
   * Download a file from the code interpreter.
   *
   * @param path File path, must start with `/home/user`.
   * @returns File content as text, or raw bytes for binary files.
   */
  async downloadFile(path: string): Promise<string | Buffer> {
    if (!path.startsWith(DEFAULT_PATH)) {
      throw new Error(`Invalid path. Path must start with ${DEFAULT_PATH}`);
    }

    logger.info(`Downloading file from ${path}`);
    const response = await this.invoke('read_files', { paths: [path] });

    if (!('result' in response) || !('content' in (response['result'] ?? {}))) {
      throw new Error(`Could not read file: ${path}`);
    }
    const result = response['result'] as Record<string, any>;

    for (const contentItem of result['content'] as Array<Record<string, any>>) {
      const itemType = contentItem['type'];
      if (itemType === 'text') {
        return contentItem['text'] ?? '';
      }
      if (itemType === 'image') {
        return Buffer.from(contentItem['data'] ?? '', 'base64');
      }
      if (itemType === 'resource') {
        const contentResource = (contentItem['resource'] ?? {}) as Record<string, any>;
        if (contentResource['type'] === 'text') {
          return contentResource['text'];
        }
        if (contentResource['type'] === 'blob') {
          const raw = Buffer.from(contentResource['blob'], 'base64');
          return _decodeTextOrBytes(raw);
        }
      }
    }
    throw new Error(`Could not read file: ${path}`);
  }

  /**
   * Download multiple files from the code interpreter.
   *
   * @param paths List of file paths, each must start with `/home/user`.
   * @returns Map of file path to content (text or raw bytes).
   */
  async downloadFiles(paths: string[]): Promise<Record<string, string | Buffer>> {
    logger.info(`Downloading ${paths.length} files`);
    for (const path of paths) {
      if (!path.startsWith(DEFAULT_PATH)) {
        throw new Error(`Invalid path. Path must start with ${DEFAULT_PATH}`);
      }
    }
    const response = await this.invoke('read_files', { paths });

    if (!('result' in response) || !('content' in (response['result'] ?? {}))) {
      throw new Error(`Could not read file: ${paths[paths.length - 1] ?? ''}`);
    }
    const result = response['result'] as Record<string, any>;

    const files: Record<string, string | Buffer> = {};
    for (const contentItem of result['content'] as Array<Record<string, any>>) {
      const uri = (contentItem['uri'] ?? '') as string;
      const filePath = uri.replace('file://', '');

      const itemType = contentItem['type'];
      if (itemType === 'text') {
        files[filePath] = contentItem['text'] ?? '';
      } else if (itemType === 'image') {
        files[filePath] = Buffer.from(contentItem['data'] ?? '', 'base64');
      } else if (itemType === 'resource') {
        const resource = (contentItem['resource'] ?? {}) as Record<string, any>;
        const resourceUri = (resource['uri'] ?? '') as string;
        const resourceFilePath = resourceUri.replace('file://', '');

        if (resource['type'] === 'text') {
          files[resourceFilePath] = resource['text'];
        } else if (resource['type'] === 'blob') {
          const raw = Buffer.from(resource['blob'], 'base64');
          files[resourceFilePath] = _decodeTextOrBytes(raw);
        }
      }
    }
    return files;
  }

  /**
   * Install Python packages in the code interpreter.
   *
   * @param packages Python packages to install; version pinning is supported
   *   (e.g. `["requests", "numpy==1.24.3"]`).
   * @param upgrade Whether to upgrade installed packages, default `false`.
   */
  async installPackages(packages: string[], upgrade = false): Promise<Record<string, any>> {
    if (!packages || packages.length === 0) {
      throw new Error('Package list cannot be empty');
    }

    for (const pkg of packages) {
      if ([';', '&', '|', '`', '$'].some((char) => pkg.includes(char))) {
        throw new Error(`Invalid package name: ${pkg}`);
      }
    }

    const packageStr = packages.join(' ');
    const upgradeFlag = upgrade ? '--upgrade' : '';
    const command = `pip install ${packageStr} ${upgradeFlag}`;

    logger.info(`Installing packages: ${packageStr}`);
    return this.invoke('execute_command', { command });
  }

  /**
   * Clear the code interpreter context.
   *
   * Resets the code interpreter to a fresh state, clearing all previously
   * defined variables, package imports, and function definitions.
   */
  async clearContext(): Promise<Record<string, any>> {
    logger.info('Clearing code interpreter context');
    return this.invoke('execute_code', {
      code: '# Context cleared',
      language: 'python',
      clear_context: true,
    });
  }
}

/**
 * Code interpreter session, the Node.js equivalent of Python's
 * `code_session` context manager.
 *
 * Python's `with code_session(...) as client:` maps to:
 *
 * ```ts
 * for await (const client of codeSession('cn-southwest-2', 'my-ci')) {
 *   await client.executeCode("print('Hello, World!')");
 * }
 * ```
 *
 * or to the explicit lifecycle:
 *
 * ```ts
 * const session = codeSession('cn-southwest-2', 'my-ci');
 * await session.enter();
 * try {
 *   await session.client.executeCode("print('Hello, World!')");
 * } finally {
 *   await session.exit();
 * }
 * ```
 */
export class CodeSession implements AsyncIterable<CodeInterpreter> {
  /** The code interpreter client bound to this session. */
  readonly client: CodeInterpreter;

  private readonly _codeInterpreterName: string;
  private readonly _apiKey: string | null;

  constructor(client: CodeInterpreter, codeInterpreterName: string, apiKey: string | null = null) {
    this.client = client;
    this._codeInterpreterName = codeInterpreterName;
    this._apiKey = apiKey;
  }

  /** Start the session (Python `__enter__`). Starts it only once. */
  async enter(): Promise<CodeInterpreter> {
    if (!this.client.sessionId) {
      await this.client.startSession(
        this._codeInterpreterName,
        DEFAULT_SESSION_NAME,
        this._apiKey,
      );
    }
    return this.client;
  }

  /** Stop the session (Python `__exit__`); a no-op when no session is active. */
  async exit(): Promise<void> {
    await this.client.stopSession(this._apiKey);
  }

  /** Yield the client, starting the session on enter and stopping it on exit. */
  async *[Symbol.asyncIterator](): AsyncGenerator<CodeInterpreter, void, undefined> {
    try {
      yield await this.enter();
    } finally {
      await this.exit();
    }
  }
}

/**
 * Code interpreter session context manager.
 *
 * @param region Region name, e.g. `"cn-southwest-2"`.
 * @param codeInterpreterName Code interpreter name.
 * @param authType Authentication type, `"API_KEY"` or `"IAM"`. Defaults to `"API_KEY"`.
 * @param apiKey API Key for authentication (API_KEY mode); read from the
 *   environment when not provided.
 * @param verifySsl SSL verification: `true` to verify, `false` to skip, or a
 *   string path to a CA bundle. Defaults to `true`.
 */
export function codeSession(
  region: string,
  codeInterpreterName: string,
  authType = 'API_KEY',
  apiKey: string | null = null,
  verifySsl: boolean | string = true,
): CodeSession {
  const client = new CodeInterpreter(region, null, authType, verifySsl);
  return new CodeSession(client, codeInterpreterName, apiKey);
}

/**
 * Run a callback with an active code interpreter session.
 *
 * Node.js equivalent of Python's `with code_session(...) as client:`; the
 * session is stopped when the callback finishes, even if it throws.
 */
export async function withCodeSession<T>(
  region: string,
  codeInterpreterName: string,
  fn: (client: CodeInterpreter) => Promise<T> | T,
  authType = 'API_KEY',
  apiKey: string | null = null,
  verifySsl: boolean | string = true,
): Promise<T> {
  const session = codeSession(region, codeInterpreterName, authType, apiKey, verifySsl);
  await session.enter();
  try {
    return await fn(session.client);
  } finally {
    await session.exit();
  }
}

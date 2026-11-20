/**
 * AgentArts Code Interpreter Module.
 *
 * Provides secure code execution in sandboxed environments:
 * - CodeInterpreter: standard sandbox code interpreter
 * - codeSession: context manager for sandbox sessions
 * - withCodeSession: callback form of `codeSession` (Node.js idiom)
 * - CodeSession: the session object returned by `codeSession`
 */

export {
  CodeInterpreter,
  CodeSession,
  codeSession,
  withCodeSession,
  DEFAULT_PATH,
  DEFAULT_TIMEOUT,
  SUPPORTED_CODE_LANGUAGES,
} from './code-interpreter-client.js';
export type { CodeLanguage, UploadFileSpec } from './code-interpreter-client.js';

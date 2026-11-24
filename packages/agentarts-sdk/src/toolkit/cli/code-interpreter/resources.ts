/** code-interpreter CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { CodeInterpreter } from '../../../sdk/tools/code_interpreter/code-interpreter-client.js';
import * as operations from '../../operations/code-interpreter/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const codeInterpreterCommands: OperationCommand[] = [
  {
    name: 'create',
    method: 'createCodeInterpreter',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      { key: 'authType', flag: 'auth-type', kind: 'string', required: false },
      { key: 'apiKeyName', flag: 'api-key-name', kind: 'string', required: false },
      { key: 'description', flag: 'description', kind: 'string', required: false },
      {
        key: 'executionAgencyName',
        flag: 'execution-agency-name',
        kind: 'string',
        required: false,
      },
      { key: 'observability', flag: 'observability', kind: 'object', required: false },
      { key: 'networkConfig', flag: 'network-config', kind: 'object', required: false },
      { key: 'agentGatewayId', flag: 'agent-gateway-id', kind: 'string', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createCodeInterpreter(
        args as Parameters<CodeInterpreter['createCodeInterpreter']>,
        options,
      ),
  },
  {
    name: 'list',
    method: 'listCodeInterpreters',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: false },
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'offset', flag: 'offset', kind: 'number', required: false },
      { key: 'sortKey', flag: 'sort-key', kind: 'string', required: false },
      { key: 'sortDir', flag: 'sort-dir', kind: 'string', required: false },
      {
        key: 'tagKeyExists',
        flag: 'tag-key-exists',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagKeyMatches',
        flag: 'tag-key-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagValueMatches',
        flag: 'tag-value-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      { key: 'tagMatchPolicy', flag: 'tag-match-policy', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listCodeInterpreters(
        args as Parameters<CodeInterpreter['listCodeInterpreters']>,
        options,
      ),
  },
  {
    name: 'update',
    method: 'updateCodeInterpreter',
    fields: [
      {
        key: 'codeInterpreterId',
        flag: 'code-interpreter-id',
        kind: 'string',
        required: true,
        positional: true,
      },
      { key: 'observability', flag: 'observability', kind: 'object', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.updateCodeInterpreter(
        args as Parameters<CodeInterpreter['updateCodeInterpreter']>,
        options,
      ),
  },
  {
    name: 'get',
    method: 'getCodeInterpreter',
    fields: [
      {
        key: 'codeInterpreterId',
        flag: 'code-interpreter-id',
        kind: 'string',
        required: true,
        positional: true,
      },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getCodeInterpreter(
        args as Parameters<CodeInterpreter['getCodeInterpreter']>,
        options,
      ),
  },
  {
    name: 'delete',
    method: 'deleteCodeInterpreter',
    fields: [
      {
        key: 'codeInterpreterId',
        flag: 'code-interpreter-id',
        kind: 'string',
        required: true,
        positional: true,
      },
    ],
    destructive: true,
    session: false,
    run: (args, options) =>
      operations.deleteCodeInterpreter(
        args as Parameters<CodeInterpreter['deleteCodeInterpreter']>,
        options,
      ),
  },
  {
    name: 'start-session',
    method: 'startSession',
    fields: [
      {
        key: 'codeInterpreterName',
        flag: 'code-interpreter-name',
        kind: 'string',
        required: true,
        positional: true,
      },
      { key: 'sessionName', flag: 'session-name', kind: 'string', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
      { key: 'sessionTimeout', flag: 'session-timeout', kind: 'number', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.startSession(args as Parameters<CodeInterpreter['startSession']>, options),
  },
  {
    name: 'get-session',
    method: 'getSession',
    fields: [
      {
        key: 'codeInterpreterName',
        flag: 'code-interpreter-name',
        kind: 'string',
        required: true,
        positional: true,
      },
      {
        key: 'sessionId',
        flag: 'session-id',
        kind: 'string',
        required: false,
        cliRequired: true,
        positional: true,
      },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getSession(args as Parameters<CodeInterpreter['getSession']>, options),
  },
  {
    name: 'stop-session',
    method: 'stopSession',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.stopSession(args as Parameters<CodeInterpreter['stopSession']>, options),
  },
  {
    name: 'invoke',
    method: 'invoke',
    fields: [
      { key: 'operateType', flag: 'operate-type', kind: 'string', required: true },
      { key: 'arguments_', flag: 'arguments', kind: 'object', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.invoke(args as Parameters<CodeInterpreter['invoke']>, options),
  },
  {
    name: 'execute-code',
    method: 'executeCode',
    fields: [
      { key: 'code', flag: 'code', kind: 'string', required: true },
      { key: 'language', flag: 'language', kind: 'string', required: false },
      { key: 'clearContext', flag: 'clear-context', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.executeCode(args as Parameters<CodeInterpreter['executeCode']>, options),
  },
  {
    name: 'execute-command',
    method: 'executeCommand',
    fields: [{ key: 'command', flag: 'command', kind: 'string', required: true }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.executeCommand(args as Parameters<CodeInterpreter['executeCommand']>, options),
  },
  {
    name: 'upload-file',
    method: 'uploadFile',
    fields: [
      { key: 'path', flag: 'path', kind: 'string', required: true },
      { key: 'content', flag: 'content', kind: 'string', required: true },
      { key: 'description', flag: 'description', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.uploadFile(args as Parameters<CodeInterpreter['uploadFile']>, options),
  },
  {
    name: 'upload-files',
    method: 'uploadFiles',
    fields: [{ key: 'files', flag: 'files', kind: 'array', items: 'object', required: true }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.uploadFiles(args as Parameters<CodeInterpreter['uploadFiles']>, options),
  },
  {
    name: 'download-file',
    method: 'downloadFile',
    outputFileKind: 'content',
    fields: [{ key: 'path', flag: 'path', kind: 'string', required: true }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.downloadFile(args as Parameters<CodeInterpreter['downloadFile']>, options),
  },
  {
    name: 'download-files',
    method: 'downloadFiles',
    fields: [{ key: 'paths', flag: 'paths', kind: 'array', items: 'string', required: true }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.downloadFiles(args as Parameters<CodeInterpreter['downloadFiles']>, options),
  },
  {
    name: 'install-packages',
    method: 'installPackages',
    fields: [
      { key: 'packages', flag: 'packages', kind: 'array', items: 'string', required: true },
      { key: 'upgrade', flag: 'upgrade', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.installPackages(args as Parameters<CodeInterpreter['installPackages']>, options),
  },
  {
    name: 'clear-context',
    method: 'clearContext',
    fields: [],
    destructive: true,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.clearContext(args as Parameters<CodeInterpreter['clearContext']>, options),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, codeInterpreterCommands, { region: true });
}

export function createResourceCommand(): Command {
  const command = new Command('code-interpreter').description(
    'code-interpreter resource and session management',
  );
  registerResourceCommands(command);
  return command;
}

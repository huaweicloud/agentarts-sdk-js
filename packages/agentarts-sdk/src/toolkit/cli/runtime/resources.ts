/** runtime CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { RuntimeClient } from '../../../sdk/service/runtime-client.js';
import * as operations from '../../operations/runtime/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const runtimeCommands: OperationCommand[] = [
  {
    name: 'ping',
    method: 'pingAgent',
    fields: [
      { key: 'port', flag: 'port', kind: 'number', required: false },
      { key: 'host', flag: 'host', kind: 'string', required: false },
      { key: 'timeout', flag: 'timeout', kind: 'number', required: false },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args) => operations.pingAgent(args as Parameters<typeof operations.pingAgent>[0]),
  },
  {
    name: 'create',
    method: 'createAgent',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createAgent(args as Parameters<RuntimeClient['createAgent']>, options),
  },
  {
    name: 'update',
    method: 'updateAgent',
    fields: [
      { key: 'agentId', flag: 'agent-id', kind: 'string', required: true },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.updateAgent(args as Parameters<RuntimeClient['updateAgent']>, options),
  },
  {
    name: 'upsert',
    method: 'createOrUpdateAgent',
    fields: [
      { key: 'agentName', flag: 'agent-name', kind: 'string', required: true },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createOrUpdateAgent(
        args as Parameters<RuntimeClient['createOrUpdateAgent']>,
        options,
      ),
  },
  {
    name: 'list',
    method: 'getAgents',
    fields: [{ key: 'options', flag: 'options', kind: 'object', required: false }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getAgents(args as Parameters<RuntimeClient['getAgents']>, options),
  },
  {
    name: 'get',
    method: 'findAgentByName',
    fields: [{ key: 'agentName', flag: 'agent-name', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.findAgentByName(args as Parameters<RuntimeClient['findAgentByName']>, options),
  },
  {
    name: 'get-by-id',
    method: 'findAgentById',
    fields: [{ key: 'agentId', flag: 'agent-id', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.findAgentById(args as Parameters<RuntimeClient['findAgentById']>, options),
  },
  {
    name: 'delete',
    method: 'deleteAgentByName',
    fields: [{ key: 'agentName', flag: 'agent-name', kind: 'string', required: true }],
    destructive: true,
    session: false,
    run: (args, options) =>
      operations.deleteAgentByName(args as Parameters<RuntimeClient['deleteAgentByName']>, options),
  },
  {
    name: 'create-endpoint',
    method: 'createAgentEndpoint',
    fields: [
      { key: 'agentId', flag: 'agent-id', kind: 'string', required: true },
      { key: 'endpointName', flag: 'endpoint-name', kind: 'string', required: true },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createAgentEndpoint(
        args as Parameters<RuntimeClient['createAgentEndpoint']>,
        options,
      ),
  },
  {
    name: 'update-endpoint',
    method: 'updateAgentEndpoint',
    fields: [
      { key: 'agentId', flag: 'agent-id', kind: 'string', required: true },
      { key: 'endpointName', flag: 'endpoint-name', kind: 'string', required: true },
      { key: 'options', flag: 'options', kind: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.updateAgentEndpoint(
        args as Parameters<RuntimeClient['updateAgentEndpoint']>,
        options,
      ),
  },
  {
    name: 'delete-endpoint',
    method: 'deleteAgentEndpoint',
    fields: [
      { key: 'agentId', flag: 'agent-id', kind: 'string', required: true },
      { key: 'endpointName', flag: 'endpoint-name', kind: 'string', required: true },
    ],
    destructive: true,
    session: false,
    run: (args, options) =>
      operations.deleteAgentEndpoint(
        args as Parameters<RuntimeClient['deleteAgentEndpoint']>,
        options,
      ),
  },
  {
    name: 'get-endpoint',
    method: 'findAgentEndpoint',
    fields: [
      { key: 'agentId', flag: 'agent-id', kind: 'string', required: true },
      { key: 'endpointName', flag: 'endpoint-name', kind: 'string', required: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.findAgentEndpoint(args as Parameters<RuntimeClient['findAgentEndpoint']>, options),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, runtimeCommands, { region: true });
}

export function createResourceCommand(): Command {
  const command = new Command('runtime').description('runtime resource and session management');
  registerResourceCommands(command);
  return command;
}

/** swr CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { SWRClient } from '../../../sdk/service/swr-client.js';
import * as operations from '../../operations/swr/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const swrCommands: OperationCommand[] = [
  {
    name: 'get-organization',
    method: 'getOrganization',
    fields: [{ key: 'organization', flag: 'organization', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getOrganization(args as Parameters<SWRClient['getOrganization']>, options),
  },
  {
    name: 'create-organization',
    method: 'createOrganization',
    fields: [{ key: 'organization', flag: 'organization', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createOrganization(args as Parameters<SWRClient['createOrganization']>, options),
  },
  {
    name: 'create-or-get-organization',
    method: 'createOrGetOrganization',
    fields: [{ key: 'organization', flag: 'organization', kind: 'string', required: true }],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createOrGetOrganization(
        args as Parameters<SWRClient['createOrGetOrganization']>,
        options,
      ),
  },
  {
    name: 'get-repository',
    method: 'getRepository',
    fields: [
      { key: 'organization', flag: 'organization', kind: 'string', required: true },
      { key: 'repository', flag: 'repository', kind: 'string', required: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getRepository(args as Parameters<SWRClient['getRepository']>, options),
  },
  {
    name: 'create-repository',
    method: 'createRepository',
    fields: [
      { key: 'organization', flag: 'organization', kind: 'string', required: true },
      { key: 'repository', flag: 'repository', kind: 'string', required: true },
      { key: 'isPublic', flag: 'is-public', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createRepository(args as Parameters<SWRClient['createRepository']>, options),
  },
  {
    name: 'create-or-get-repository',
    method: 'createOrGetRepository',
    fields: [
      { key: 'organization', flag: 'organization', kind: 'string', required: true },
      { key: 'repository', flag: 'repository', kind: 'string', required: true },
      { key: 'isPublic', flag: 'is-public', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createOrGetRepository(
        args as Parameters<SWRClient['createOrGetRepository']>,
        options,
      ),
  },
  {
    name: 'create-secret',
    method: 'createSwrSecret',
    fields: [],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createSwrSecret(args as Parameters<SWRClient['createSwrSecret']>, options),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, swrCommands, { region: true });
}

export function createResourceCommand(): Command {
  const command = new Command('swr').description('swr resource and session management');
  registerResourceCommands(command);
  return command;
}

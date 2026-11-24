/** iam CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { IAMClient } from '../../../sdk/service/iam-client.js';
import * as operations from '../../operations/iam/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const iamCommands: OperationCommand[] = [
  {
    name: 'create-agency',
    method: 'createAgency',
    fields: [
      { key: 'agencyName', flag: 'agency-name', kind: 'string', required: true },
      { key: 'trustPolicy', flag: 'trust-policy', kind: 'string', required: true },
      { key: 'path', flag: 'path', kind: 'string', required: false },
      { key: 'maxSessionDuration', flag: 'max-session-duration', kind: 'number', required: false },
      { key: 'description', flag: 'description', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createAgency(args as Parameters<IAMClient['createAgency']>, options),
  },
  {
    name: 'list-policies',
    method: 'listPolicies',
    fields: [
      { key: 'policyType', flag: 'policy-type', kind: 'string', required: false },
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
      { key: 'pathPrefix', flag: 'path-prefix', kind: 'string', required: false },
      { key: 'onlyAttached', flag: 'only-attached', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listPolicies(args as Parameters<IAMClient['listPolicies']>, options),
  },
  {
    name: 'list-agencies',
    method: 'listAgencies',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: false },
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'marker', flag: 'marker', kind: 'string', required: false },
      { key: 'pathPrefix', flag: 'path-prefix', kind: 'string', required: false },
      { key: 'onlyAttached', flag: 'only-attached', kind: 'boolean', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listAgencies(args as Parameters<IAMClient['listAgencies']>, options),
  },
  {
    name: 'attach-agency-policy',
    method: 'attachAgencyPolicy',
    fields: [
      { key: 'agencyId', flag: 'agency-id', kind: 'string', required: true },
      { key: 'policyId', flag: 'policy-id', kind: 'string', required: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.attachAgencyPolicy(args as Parameters<IAMClient['attachAgencyPolicy']>, options),
  },
  {
    name: 'create-agency-with-policy',
    method: 'createAgencyWithPolicy',
    fields: [
      { key: 'agencyName', flag: 'agency-name', kind: 'string', required: true },
      { key: 'trustPolicy', flag: 'trust-policy', kind: 'string', required: true },
      { key: 'policyName', flag: 'policy-name', kind: 'string', required: true },
      { key: 'path', flag: 'path', kind: 'string', required: false },
      { key: 'maxSessionDuration', flag: 'max-session-duration', kind: 'number', required: false },
      { key: 'description', flag: 'description', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createAgencyWithPolicy(
        args as Parameters<IAMClient['createAgencyWithPolicy']>,
        options,
      ),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, iamCommands, { region: false });
}

export function createResourceCommand(): Command {
  const command = new Command('iam').description('iam resource and session management');
  registerResourceCommands(command);
  return command;
}

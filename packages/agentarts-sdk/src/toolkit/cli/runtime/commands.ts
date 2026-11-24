/**
 * Runtime CLI Commands.
 *
 * Ported from `agentarts/toolkit/cli/runtime/commands.py`. Provides the
 * `agentarts runtime` command group for runtime operations (cloud only):
 *
 * - `invoke`: invoke agent with JSON payload
 * - `exec-command`: execute command with streaming response
 * - `upload-files`: upload files to runtime
 * - `download-files`: download files from runtime
 * - `start-session`: start runtime session
 * - `stop-session`: stop runtime session
 */

import { Command } from 'commander';

import { createDownloadFilesCommand } from './download-files.js';
import { createExecCommand } from './exec-command.js';
import { createInvokeCommand } from './invoke.js';
import { createStartSessionCommand } from './start-session.js';
import { createStopSessionCommand } from './stop-session.js';
import { createUploadFilesCommand } from './upload-files.js';
import { registerResourceCommands } from './resources.js';

/**
 * Build the `runtime` command group (Python `runtime_app`).
 *
 * @param name Group name (`runtime` by default).
 */
export function createRuntimeAppCommand(name = 'runtime'): Command {
  const command = new Command(name);

  command.description(
    'Runtime operations (cloud only): invoke, exec-command, upload-files, download-files, start-session, stop-session',
  );

  command.addCommand(createInvokeCommand());
  command.addCommand(createExecCommand());
  command.addCommand(createUploadFilesCommand());
  command.addCommand(createDownloadFilesCommand());
  command.addCommand(createStartSessionCommand());
  command.addCommand(createStopSessionCommand());
  registerResourceCommands(command);

  // Python's typer group prints its help when no subcommand is given and exits
  // with code 0; commander errors with exit code 1, so print the help here.
  command.action(() => {
    command.outputHelp();
  });

  return command;
}

/** Register the `runtime` command group on an existing program. */
export function registerRuntimeAppCommand(program: Command): void {
  program.addCommand(createRuntimeAppCommand());
}

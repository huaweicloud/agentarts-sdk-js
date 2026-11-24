/**
 * AgentArts CLI Entry Point.
 *
 * Ported from `agentarts/toolkit/main.py`. This module only handles command
 * registration: command definitions live in `toolkit/cli/**` and the
 * implementation logic in `toolkit/operations/**`.
 *
 * Python's typer app is replaced by commander:
 *
 * - `--version/-v` prints `agentarts version: <version>` and exits 0;
 * - `--verbose` switches logging to DEBUG (Python `setup_logging`);
 * - invoked without a subcommand, it prints the same welcome/usage block;
 * - the commands are registered in the same order as `_COMMAND_ORDER`, with the
 *   hidden aliases `deploy` (for `launch`) and `configure` (for `config`);
 * - `api` command functions return process exit codes which their commander
 *   actions record on `process.exitCode` (see `cli/common.ts`).
 *
 * The Python auto-completion installer (`_auto_install_completion`) has no
 * commander counterpart and is intentionally not ported; users can generate a
 * shell completion script with `agentarts completion`-style tooling if needed.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { setupLogging } from '../sdk/utils/logging.js';
import { __version__ } from '../version.js';
import { normalizeRuntimeArgv } from './cli/common.js';
import { createGatewayCommand } from './cli/gateway/index.js';
import { createResourceCommand as createIdentityCommand } from './cli/identity/resources.js';
import { createResourceCommand as createBrowserCommand } from './cli/browser/resources.js';
import { createResourceCommand as createCodeInterpreterCommand } from './cli/code-interpreter/resources.js';
import { createResourceCommand as createIamCommand } from './cli/iam/resources.js';
import { createResourceCommand as createSwrCommand } from './cli/swr/resources.js';
import { memoryApp } from './cli/memory/index.js';
import { createRuntimeAppCommand } from './cli/runtime/commands.js';
import { createConfigCommand } from './cli/runtime/config.js';
import { createDeployCommand } from './cli/runtime/deploy.js';
import { createDestroyCommand } from './cli/runtime/destroy.js';
import { createDevCommand } from './cli/runtime/dev.js';
import { createInitCommand } from './cli/runtime/init.js';
import { createInvokeCommand } from './cli/runtime/invoke.js';
import { console } from './utils/console.js';

export { console };

/**
 * Order in which commands are shown in `--help`, mirroring Python's
 * `_COMMAND_ORDER`.
 */
export const COMMAND_ORDER: readonly string[] = [
  'init',
  'config',
  'dev',
  'launch',
  'invoke',
  'runtime',
  'destroy',
  'gateway',
  'memory',
  'identity',
  'browser',
  'code-interpreter',
  'iam',
  'swr',
  'deploy',
  'configure',
];

/**
 * Configure logging for the toolkit CLI (Python `setup_logging`).
 *
 * @param verbose When `true`, use DEBUG; otherwise INFO.
 */
export function setupToolkitLogging(verbose = false): void {
  setupLogging(verbose ? 'DEBUG' : 'INFO');
}

/** Print the no-subcommand welcome/usage block. */
function printWelcome(): void {
  console.print();
  console.print(`[bold cyan]AgentArts CLI[/bold cyan] [dim]v${__version__}[/dim]`);
  console.print('[dim]Huawei Cloud Agent Development Toolkit[/dim]');
  console.print();
  console.print('[yellow]Usage:[/yellow] agentarts [OPTIONS] COMMAND [ARGS]...');
  console.print();
  console.print('[yellow]Try:[/yellow]');
  console.print('  [cyan]agentarts --help[/cyan]     Show available commands');
  console.print('  [cyan]agentarts init --help[/cyan]  Show init command help');
  console.print();
}

/**
 * Build the `agentarts` program with every command registered.
 *
 * Exposed separately from {@link cli} so tests (and embedders) can create a
 * fresh program without touching `process.argv`.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name('agentarts')
    .usage('[OPTIONS] COMMAND [ARGS]...')
    .description(
      'AgentArts CLI - Huawei Cloud Agent Development Toolkit\n\n' +
        'Build, test, and deploy Agent applications quickly.',
    )
    .version(`agentarts version: ${__version__}`, '-v, --version', 'Show version and exit')
    .option('--verbose', 'Enable verbose logging (DEBUG level)', false)
    .addHelpText(
      'after',
      `
Examples:
  agentarts init -n my_agent -t langgraph
  agentarts dev --port 8080
  agentarts deploy -r cn-southwest-2 -e production`,
    );

  // Python's root callback runs for every invocation (`invoke_without_command`),
  // so configure logging before any subcommand action executes.
  program.hook('preAction', (thisCommand, actionCommand) => {
    const options = actionCommand.optsWithGlobals
      ? actionCommand.optsWithGlobals()
      : thisCommand.opts();
    setupToolkitLogging(Boolean(options['verbose']));
  });

  // Registered in `_COMMAND_ORDER` so `--help` lists them like Python's
  // `_OrderedHelpGroup` does.
  program.addCommand(createInitCommand());
  program.addCommand(createConfigCommand('config'));
  program.addCommand(createDevCommand());
  program.addCommand(createDeployCommand('launch'));
  program.addCommand(createInvokeCommand());
  program.addCommand(createRuntimeAppCommand('runtime'));
  program.addCommand(createDestroyCommand());
  program.addCommand(createGatewayCommand());
  program.addCommand(memoryApp);
  program.addCommand(createIdentityCommand());
  program.addCommand(createBrowserCommand());
  program.addCommand(createCodeInterpreterCommand());
  program.addCommand(createIamCommand());
  program.addCommand(createSwrCommand());
  // Hidden aliases: `deploy` mirrors `launch`, `configure` mirrors `config`.
  program.addCommand(createDeployCommand('deploy'), { hidden: true });
  program.addCommand(createConfigCommand('configure'), { hidden: true });

  program.action(() => {
    setupToolkitLogging(Boolean(program.opts()['verbose']));
    printWelcome();
    process.exitCode = 0;
  });

  return program;
}

/**
 * Run the CLI (Python `cli()`), parsing `process.argv`.
 *
 * Non-zero command exit codes are recorded on `process.exitCode` by the command
 * actions, so the caller (bin entry point) can let the process finish normally.
 */
export async function cli(argv: string[] = process.argv): Promise<void> {
  // `-bt` is a multi-character short flag accepted by Python's typer but not by
  // commander; rewrite it to `--bearer-token` before parsing.
  normalizeRuntimeArgv(argv);

  const program = buildProgram();
  await program.parseAsync(argv);
}

/** Whether this module is the process entry point (Python `__main__`). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return resolve(fileURLToPath(import.meta.url)) === resolve(entry);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void cli();
}

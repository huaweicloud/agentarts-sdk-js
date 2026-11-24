/** Shared CLI interaction for explicitly registered SDK business operations. */
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Command } from 'commander';
import type { OperationOptions, OperationResult } from '../operations/common.js';
import { console, echoError } from '../utils/common.js';
import { validateStructuredArguments } from './operation-validation.js';
import { confirm } from '../plugins/memory/installer/utils.js';

export interface OperationField {
  key: string;
  flag: string;
  kind: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  /** Required in a fresh CLI process even when the SDK can reuse instance state. */
  cliRequired?: boolean;
  items?: 'string' | 'object';
  /** Primary positional ID; the named flag and request file remain compatible inputs. */
  positional?: boolean;
}
export interface OperationCommand {
  name: string;
  method: string;
  fields: OperationField[];
  destructive: boolean;
  session: boolean;
  /** Explicit name/session positional context, kept separate from SDK method arguments. */
  sessionPositionals?: boolean;
  /** Accept historic resource-first tokens when session context is supplied explicitly. */
  legacyResourceFirst?: boolean;
  /** File-content results bypass JSON encoding when written to disk. */
  outputFileKind?: 'content';
  run: (args: any[], options: OperationOptions) => Promise<OperationResult>;
}

function parseValue(value: unknown, field: OperationField): unknown {
  const label = field.positional ? `<${field.key}> (or --${field.flag})` : `--${field.flag}`;
  if (value === undefined || value === null) {
    if (field.required || field.cliRequired) throw new Error(`${label} is required`);
    return undefined;
  }
  if (field.kind === 'number') {
    if (
      !['number', 'string'].includes(typeof value) ||
      (typeof value === 'string' && !value.trim())
    ) {
      throw new Error(`${label} must be a finite number`);
    }
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || value === '' || typeof value === 'boolean') {
      throw new Error(`${label} must be a finite number`);
    }
    if (
      ['limit', 'offset'].includes(field.key) &&
      (!Number.isSafeInteger(number) || number < (field.key === 'limit' ? 1 : 0))
    ) {
      throw new Error(
        `${label} must be a ${field.key === 'limit' ? 'positive' : 'non-negative'} safe integer`,
      );
    }
    return number;
  }
  if (field.kind === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error(`${label} must be true or false`);
  }
  if (field.kind === 'object' || field.kind === 'array') {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) !== (field.kind === 'array')
    ) {
      throw new Error(`${label} must be a JSON ${field.kind}`);
    }
    if (
      field.kind === 'array' &&
      field.items &&
      parsed.some((item: unknown) =>
        field.items === 'string'
          ? typeof item !== 'string'
          : !item || typeof item !== 'object' || Array.isArray(item),
      )
    ) {
      throw new Error(`${label} must contain only ${field.items} items`);
    }
    return parsed;
  }
  if (typeof value !== 'string' || ((field.required || field.cliRequired) && !value.trim())) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function stringify(value: unknown): string {
  return JSON.stringify(
    value === undefined ? { success: true } : value,
    (_key, item) => {
      if (typeof item === 'bigint') return item.toString();
      return item && typeof item.toDict === 'function' ? item.toDict() : item;
    },
    2,
  );
}

/** Only the methods in the supplied manifest can be invoked; no arbitrary SDK dispatch. */
export function registerOperationCommands(
  group: Command,
  definitions: OperationCommand[],
  configuration: { region: boolean } = { region: true },
): void {
  for (const definition of definitions) {
    const command = group.command(definition.name).description(`Call ${definition.method}`);
    const sessionResource =
      group.name() === 'browser'
        ? { key: 'browserName', flag: 'browser-name' }
        : { key: 'codeInterpreterName', flag: 'code-interpreter-name' };
    const sessionFields: OperationField[] = definition.sessionPositionals
      ? [
          {
            key: sessionResource.key,
            flag: sessionResource.flag,
            kind: 'string',
            required: true,
            positional: true,
          },
          {
            key: 'sessionId',
            flag: 'session-id',
            kind: 'string',
            required: true,
            positional: true,
          },
        ]
      : [];
    const positionalFields = [
      ...sessionFields,
      ...definition.fields.filter((field) => field.positional),
    ];
    for (const field of positionalFields) {
      // Commander must allow the positional token to be absent so legacy flags
      // and request files can satisfy the same required ID in the action below.
      command.argument(
        `[${field.key}]`,
        `${field.required || field.cliRequired ? 'Required' : 'Optional'}. ${field.key} (or --${field.flag} / --request-file)`,
      );
    }
    if (positionalFields.length)
      command.usage(
        `[options] ${positionalFields.map((field) => (field.required || field.cliRequired ? `<${field.key}>` : `[${field.key}]`)).join(' ')}`,
      );
    for (const field of definition.fields) {
      command.option(
        `--${field.flag} <value>`,
        `${field.positional ? `Compatibility alias for <${field.key}>. ` : field.required || field.cliRequired ? 'Required. ' : ''}${field.key}${['object', 'array'].includes(field.kind) ? ' (JSON, SDK camelCase fields)' : ` (${field.kind})`}`,
      );
    }
    const local = group.name() === 'runtime' && definition.method === 'pingAgent';
    if (configuration.region && !local)
      command.option('-r, --region <region>', 'Region (defaults to SDK environment)');
    if (['browser', 'code-interpreter', 'swr'].includes(group.name())) {
      command.option('--data-endpoint <url>', 'Override sandbox data endpoint / SWR endpoint');
    }
    if (['browser', 'code-interpreter'].includes(group.name())) {
      command.option(
        '--session-auth-type <type>',
        'Sandbox data-plane authentication: API_KEY or IAM',
        'API_KEY',
      );
    }
    if (!local) command.option('-k, --skip-ssl-verification', 'Skip SSL certificate verification');
    command
      .option(
        '--request-file <path>',
        'Read method parameters as a JSON object (SDK camelCase names)',
      )
      .option('--output-file <path>', 'Write output to a file (binary preserved, otherwise JSON)')
      .option('-o, --output <format>', 'Output format: json', 'json');
    if (definition.session) {
      if (definition.sessionPositionals)
        command.option(
          `--${sessionResource.flag} <name>`,
          `Compatibility alias for <${sessionResource.key}>`,
        );
      command
        .option(
          '--resource-name <name>',
          definition.sessionPositionals
            ? `Legacy alias for <${sessionResource.key}>`
            : 'Existing browser/code-interpreter name',
        )
        .option(
          '--session-id <id>',
          definition.sessionPositionals
            ? 'Compatibility alias for <sessionId>'
            : 'Existing session ID (no session is created automatically)',
        );
    }
    if (definition.fields.some((field) => field.key === 'content')) {
      command.option('--content-file <path>', 'Read binary upload content from a local file');
    }
    if (definition.destructive) command.option('-f, --force', 'Skip deletion/reset confirmation');
    command.action(async (...raw: any[]) => {
      const current = raw[raw.length - 1] as Command;
      const options = current.opts();
      const positionalValues = new Map(
        positionalFields.map((field, index) => [field.key, raw[index]]),
      );
      try {
        if (options.output !== 'json') throw new Error('Supported output format: json');
        if (!['API_KEY', 'IAM'].includes(options.sessionAuthType ?? 'API_KEY'))
          throw new Error('Session auth type must be API_KEY or IAM');
        const input = options.requestFile
          ? JSON.parse(await readFile(options.requestFile, 'utf8'))
          : {};
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('Request file must contain a JSON object');
        const allowed = new Set(
          [...definition.fields, ...sessionFields].flatMap((field) => [
            field.key,
            field.key.replace(/_$/, ''),
          ]),
        );
        if (definition.sessionPositionals) allowed.add('resourceName');
        for (const key of Object.keys(input)) {
          if (!allowed.has(key))
            throw new Error(`Unknown SDK method parameter in request file: ${key}`);
        }
        // Preserve existing resource-ID positionals when session context is
        // explicitly supplied by flags/file (e.g. save-profile PROFILE --resource-name NAME --session-id ID).
        const methodPositionals = definition.fields.filter((field) => field.positional);
        const providedPositionals = raw
          .slice(0, positionalFields.length)
          .filter((value) => value !== undefined);
        const hasSessionName = [
          options[sessionResource.key],
          options.resourceName,
          input[sessionResource.key],
          input.resourceName,
        ].some((value) => value !== undefined);
        const hasSessionId = options.sessionId !== undefined || input.sessionId !== undefined;
        if (
          definition.legacyResourceFirst &&
          definition.sessionPositionals &&
          methodPositionals.length &&
          providedPositionals.length > 0 &&
          providedPositionals.length <= methodPositionals.length &&
          hasSessionName &&
          hasSessionId &&
          methodPositionals.every(
            (field) => options[field.key] === undefined && input[field.key] === undefined,
          )
        ) {
          positionalValues.clear();
          methodPositionals.forEach((field, index) =>
            positionalValues.set(field.key, providedPositionals[index]),
          );
        }
        const content = options.contentFile ? await readFile(options.contentFile) : undefined;
        const resolvePositional = (field: OperationField): unknown => {
          const candidates = [
            positionalValues.get(field.key),
            options[field.key],
            input[field.key],
            ...(definition.sessionPositionals && field.key === sessionResource.key
              ? [options.resourceName, input.resourceName]
              : []),
          ]
            .filter((value) => value !== undefined)
            .map((value) => parseValue(value, field));
          if (candidates.some((value) => value !== candidates[0]))
            throw new Error(
              `Conflicting IDs or names: <${field.key}>, --${field.flag} and request-file.${field.key} must match`,
            );
          return parseValue(candidates[0], field);
        };
        const args = definition.fields.map((field) => {
          if (field.positional) return resolvePositional(field);
          return field.key === 'content' && content !== undefined
            ? content
            : parseValue(
                options[field.key.replace(/_$/, '')] ??
                  input[field.key] ??
                  input[field.key.replace(/_$/, '')],
                field,
              );
        });
        const resourceName = definition.sessionPositionals
          ? (resolvePositional(sessionFields[0]) as string)
          : options.resourceName;
        const sessionId = definition.sessionPositionals
          ? (resolvePositional(sessionFields[1]) as string)
          : options.sessionId;
        validateStructuredArguments(group.name(), definition, args);
        if (definition.session && (!resourceName?.trim() || !sessionId?.trim())) {
          throw new Error('--resource-name and --session-id are required for an existing session');
        }
        if (
          definition.destructive &&
          !options.force &&
          !(await confirm(`Run ${group.name()} ${definition.name}?`, false))
        ) {
          console.print('Operation cancelled.');
          return;
        }
        const result = await definition.run(args, {
          region: options.region,
          skipSslVerification: options.skipSslVerification,
          dataEndpoint: options.dataEndpoint,
          authType: options.sessionAuthType,
          resourceName,
          sessionId,
          onAuthUrl: (url) => process.stderr.write(`Authorize this URL: ${url}\n`),
        });
        if (!result.success) throw new Error(result.error ?? 'Operation failed');
        if (options.outputFile) {
          const content =
            result.data instanceof Uint8Array ||
            (definition.outputFileKind === 'content' && typeof result.data === 'string')
              ? result.data
              : stringify(result.data);
          // Do not truncate or write before existing permissions are restricted.
          // The same descriptor is used throughout, including for existing files.
          const file = await open(
            options.outputFile,
            constants.O_WRONLY | constants.O_CREAT,
            0o600,
          );
          try {
            await file.chmod(0o600);
            await file.truncate(0);
            await file.writeFile(content);
          } finally {
            await file.close();
          }
        } else console.printPlain(stringify(result.data));
      } catch (error) {
        process.exitCode = 1;
        echoError(error instanceof Error ? error.message : String(error));
      }
    });
  }
}

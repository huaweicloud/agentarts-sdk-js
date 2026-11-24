import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { console } from 'agentarts-sdk/toolkit/utils/common';
import { identityCommands } from 'agentarts-sdk/toolkit/cli/identity/resources';
import { browserCommands } from 'agentarts-sdk/toolkit/cli/browser/resources';
import { codeInterpreterCommands } from 'agentarts-sdk/toolkit/cli/code-interpreter/resources';
import { iamCommands } from 'agentarts-sdk/toolkit/cli/iam/resources';
import { swrCommands } from 'agentarts-sdk/toolkit/cli/swr/resources';
import { runtimeCommands } from 'agentarts-sdk/toolkit/cli/runtime/resources';
import { registerOperationCommands } from 'agentarts-sdk/toolkit/cli/operation-commands';
import type {
  OperationCommand,
  OperationField,
} from 'agentarts-sdk/toolkit/cli/operation-commands';
import { executeOperation, OperationResult } from 'agentarts-sdk/toolkit/operations/common';
import { RequestResult } from 'agentarts-sdk/sdk/service/http-client';

const mocks = vi.hoisted(() => ({
  client: {} as Record<string, any>,
  constructor: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('agentarts-sdk/sdk/service/identity/identity-client', async (original) => ({
  ...(await original<any>()),
  IdentityClient: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/sdk/tools/browser/browser-client', async (original) => ({
  ...(await original<any>()),
  Browser: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/sdk/tools/code_interpreter/code-interpreter-client', async (original) => ({
  ...(await original<any>()),
  CodeInterpreter: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/sdk/service/iam-client', async (original) => ({
  ...(await original<any>()),
  IAMClient: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/sdk/service/swr-client', async (original) => ({
  ...(await original<any>()),
  SWRClient: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/sdk/service/runtime-client', async (original) => ({
  ...(await original<any>()),
  RuntimeClient: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
  LocalRuntimeClient: vi.fn(function (...args) {
    mocks.constructor(...args);
    return mocks.client;
  }),
}));
vi.mock('agentarts-sdk/toolkit/plugins/memory/installer/utils', async (original) => ({
  ...(await original<any>()),
  confirm: mocks.confirm,
}));

const groups = {
  identity: identityCommands,
  browser: browserCommands,
  'code-interpreter': codeInterpreterCommands,
  iam: iamCommands,
  swr: swrCommands,
  runtime: runtimeCommands,
};
const cases = Object.entries(groups).flatMap(([group, definitions]) =>
  definitions.map((definition) => ({ group, definition })),
);
const dataClose = vi.fn();
beforeEach(() => {
  process.exitCode = 0;
  mocks.client = {
    controlPlaneClient: { close: vi.fn() },
    _dataPlaneClient: { close: dataClose },
    dataPlaneClient: { close: dataClose },
  };
  dataClose.mockReset();
  mocks.constructor.mockReset();
  mocks.confirm.mockReset().mockResolvedValue(false);
  vi.spyOn(console, 'print').mockImplementation(() => undefined);
  vi.spyOn(console, 'printPlain').mockImplementation(() => undefined);
});
afterEach(() => {
  process.exitCode = 0;
});
function value(field: OperationField): any {
  return field.kind === 'array'
    ? field.items === 'object'
      ? [{ key: 'example', value: 'value' }]
      : ['example']
    : field.kind === 'object'
      ? {}
      : field.kind === 'number'
        ? 3
        : field.kind === 'boolean'
          ? false
          : 'example';
}
function program(group: string, definition: OperationCommand) {
  const command = new Command(group).exitOverride().configureOutput({ writeErr: () => undefined });
  registerOperationCommands(command, [definition], { region: group !== 'iam' });
  return command;
}

describe('SDK -> Operations -> CLI coverage', () => {
  it.each(cases)(
    '$group $definition.name forwards every method parameter through Operations',
    async ({ group, definition }) => {
      const expected = definition.fields.map(value);
      if (group === 'identity' && definition.fields[0]?.key === 'options') {
        expected[0] = {
          providerName: 'provider',
          workloadAccessToken: 'token',
          ...(definition.method === 'getResourceOauth2Token' ? { authFlow: 'M2M' } : {}),
          ...(definition.method === 'getResourceStsToken' ? { agencySessionName: 'session' } : {}),
        };
      }
      mocks.client[definition.method] = vi
        .fn()
        .mockResolvedValue(
          definition.method === 'createSwrSecret' ? ['registry', 'user', 'secret'] : { ok: true },
        );
      const args = [
        definition.name,
        ...definition.fields.flatMap((field, index) => [
          `--${field.flag}`,
          typeof expected[index] === 'object'
            ? JSON.stringify(expected[index])
            : String(expected[index]),
        ]),
      ];
      if (definition.session)
        args.push('--resource-name', 'existing-resource', '--session-id', 'existing-session');
      if (definition.destructive) args.push('--force');
      await program(group, definition).parseAsync(args, { from: 'user' });
      expect(process.exitCode, vi.mocked(console.print).mock.calls.flat().join('\n')).toBe(0);
      if (definition.method === 'getResourceOauth2Token') {
        expect(mocks.client[definition.method]).toHaveBeenCalledWith({
          ...expected[0],
          onAuthUrl: expect.any(Function),
        });
      } else if (definition.method === 'pingAgent') {
        expect(mocks.constructor).toHaveBeenCalledWith(...expected.slice(0, 3));
        expect(mocks.client.pingAgent).toHaveBeenCalledWith(expected[3]);
      } else expect(mocks.client[definition.method]).toHaveBeenCalledWith(...expected);
      expect(console.printPlain).toHaveBeenCalledOnce();
      if (definition.session) {
        expect(mocks.client.sessionId).toBe('existing-session');
        expect(mocks.client[group === 'browser' ? 'browserName' : 'codeInterpreterName']).toBe(
          'existing-resource',
        );
      }
      if (group === 'browser' || group === 'code-interpreter')
        expect(dataClose).toHaveBeenCalledOnce();
    },
  );

  it.each(Object.entries(groups))('%s has unique command names and flags', (group, definitions) => {
    const command = new Command(group);
    registerOperationCommands(command, definitions, { region: group !== 'iam' });
    expect(new Set(command.commands.map((c) => c.name())).size).toBe(definitions.length);
    for (const child of command.commands) {
      const flags = child.options.flatMap((option) => [option.short, option.long].filter(Boolean));
      expect(new Set(flags).size, child.name()).toBe(flags.length);
    }
  });

  it('rejects missing required fields before constructing an SDK client', async () => {
    await program(
      'identity',
      identityCommands.find((d) => d.name === 'get-workload-identity')!,
    ).parseAsync(['get-workload-identity'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('does not start a sandbox implicitly when a session ID is missing', async () => {
    const definition = browserCommands.find((d) => d.name === 'navigate')!;
    await program('browser', definition).parseAsync(['navigate', '--url', 'https://example.com'], {
      from: 'user',
    });
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('cancels destructive operations before SDK construction', async () => {
    const definition = browserCommands.find((d) => d.name === 'delete')!;
    await program('browser', definition).parseAsync(['delete', '--browser-id', 'example'], {
      from: 'user',
    });
    expect(mocks.confirm).toHaveBeenCalledWith(expect.any(String), false);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it.each(['NaN', 'Infinity', 'true'])('rejects invalid numeric field %s', async (value) => {
    const definition = browserCommands.find((d) => d.name === 'list')!;
    await program('browser', definition).parseAsync(['list', '--limit', value], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it('supports request files with CLI overrides and preserves false', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentarts-cli-'));
    try {
      const file = join(directory, 'request.json');
      await writeFile(file, JSON.stringify({ policyType: 'system', limit: 5, onlyAttached: true }));
      mocks.client.listPolicies = vi.fn().mockResolvedValue({ policies: [] });
      const definition = iamCommands.find((d) => d.name === 'list-policies')!;
      await program('iam', definition).parseAsync(
        ['list-policies', '--request-file', file, '--only-attached', 'false'],
        { from: 'user' },
      );
      expect(mocks.client.listPolicies).toHaveBeenCalledWith(
        'system',
        5,
        undefined,
        undefined,
        false,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uploads file bytes and writes binary results without JSON conversion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agentarts-binary-'));
    try {
      const input = join(directory, 'in.bin'),
        output = join(directory, 'out.bin');
      const bytes = Buffer.from([0, 255, 128]);
      await writeFile(input, bytes);
      mocks.client.uploadFile = vi.fn().mockResolvedValue(bytes);
      const definition = codeInterpreterCommands.find((d) => d.name === 'upload-file')!;
      await program('code-interpreter', definition).parseAsync(
        [
          'upload-file',
          '--path',
          '/home/user/x',
          '--content-file',
          input,
          '--output-file',
          output,
          '--resource-name',
          'tool',
          '--session-id',
          'session',
        ],
        { from: 'user' },
      );
      expect(mocks.client.uploadFile).toHaveBeenCalledWith('/home/user/x', bytes, undefined);
      expect(await readFile(output)).toEqual(bytes);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('passes OAuth authorization URL callbacks without serializing functions', async () => {
    const definition = identityCommands.find((d) => d.name === 'get-resource-oauth2-token')!;
    mocks.client.getResourceOauth2Token = vi.fn().mockResolvedValue('token');
    const result = await definition.run(
      [{ providerName: 'provider', workloadAccessToken: 'workload', authFlow: 'USER_FEDERATION' }],
      { onAuthUrl: () => undefined },
    );
    expect(result.success).toBe(true);
    expect(mocks.client.getResourceOauth2Token.mock.calls[0][0].onAuthUrl).toBeTypeOf('function');
  });

  it('returns structured errors and closes sandbox clients after SDK failures', async () => {
    const definition = browserCommands.find((d) => d.name === 'get')!;
    mocks.client.getBrowser = vi.fn().mockRejectedValue(new Error('denied'));
    const result = await definition.run(['id'], {});
    expect(result).toMatchObject({ success: false, error: 'denied' });
    expect(dataClose).toHaveBeenCalledOnce();
  });

  it('preserves HTTP error payloads and treats unsuccessful results as failures', async () => {
    const close = vi.fn();
    const result = await executeOperation(
      () => ({}),
      () =>
        new RequestResult({
          success: false,
          statusCode: 403,
          data: { error_code: 'denied' },
          error: 'forbidden',
        }),
      close,
    );
    expect(result).toMatchObject({
      success: false,
      error: 'forbidden',
      data: { error_code: 'denied' },
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('catches constructor and cleanup errors at the operation boundary', async () => {
    expect(
      await executeOperation(
        () => {
          throw new Error('config');
        },
        () => null,
      ),
    ).toMatchObject({ success: false, error: 'config' });
    expect(
      await executeOperation(
        () => ({}),
        () => null,
        () => {
          throw new Error('close');
        },
      ),
    ).toMatchObject({ success: false, error: expect.stringContaining('close') });
  });
});

const requiredCases = cases.flatMap(({ group, definition }) =>
  definition.fields
    .filter((f) => f.required || f.cliRequired)
    .map((field) => ({ group, definition, field })),
);
describe('parameter and lookup regression checks', () => {
  it.each(requiredCases)(
    '$group $definition.name requires $field.key before SDK construction',
    async ({ group, definition, field }) => {
      const args = [
        definition.name,
        ...definition.fields
          .filter((f) => f !== field)
          .flatMap((f) => [
            `--${f.flag}`,
            typeof value(f) === 'object' ? JSON.stringify(value(f)) : String(value(f)),
          ]),
      ];
      await program(group, definition).parseAsync(args, { from: 'user' });
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(cases.filter(({ definition }) => definition.name.startsWith('get')))(
    '$group $definition.name accepts only its SDK-required identifiers and session context',
    async ({ group, definition }) => {
      mocks.client[definition.method] = vi.fn().mockResolvedValue({ id: 'detail' });
      const args = [
        definition.name,
        ...definition.fields
          .filter((f) => f.required || f.cliRequired)
          .flatMap((f) => [
            `--${f.flag}`,
            f.kind === 'object'
              ? JSON.stringify({
                  providerName: 'p',
                  workloadAccessToken: 't',
                  ...(definition.method === 'getResourceStsToken'
                    ? { agencySessionName: 's' }
                    : {}),
                  ...(definition.method === 'getResourceOauth2Token' ? { authFlow: 'M2M' } : {}),
                })
              : String(value(f)),
          ]),
      ];
      if (definition.session) args.push('--resource-name', 'resource', '--session-id', 'session');
      await program(group, definition).parseAsync(args, { from: 'user' });
      expect(process.exitCode).toBe(0);
      expect(console.printPlain).toHaveBeenCalledWith(JSON.stringify({ id: 'detail' }, null, 2));
    },
  );
  it('preserves SDK null for a missing runtime instead of inventing a successful object', async () => {
    mocks.client.findAgentByName = vi.fn().mockResolvedValue(null);
    const def = runtimeCommands.find((d) => d.name === 'get')!;
    await program('runtime', def).parseAsync(['get', '--agent-name', 'absent'], { from: 'user' });
    expect(console.printPlain).toHaveBeenCalledWith('null');
  });
  it.each(['-1', '0', '1.5', '9007199254740992'])(
    'rejects invalid page limit %s',
    async (limit) => {
      await program(
        'browser',
        browserCommands.find((d) => d.name === 'list')!,
      ).parseAsync(['list', '--limit', limit], { from: 'user' });
      expect(mocks.constructor).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
  it.each([
    ['runtime', 'list', '{"limit":"10"}'],
    ['runtime', 'list', '{"offset":-1}'],
    ['runtime', 'create', '{"envVars":{}}'],
    ['identity', 'get-resource-api-key', '{}'],
    ['identity', 'get-resource-sts-token', '{"providerName":"p","workloadAccessToken":"t"}'],
    [
      'identity',
      'get-resource-oauth2-token',
      '{"providerName":"p","workloadAccessToken":"t","authFlow":"invalid"}',
    ],
  ])('rejects invalid typed JSON options for %s %s', async (group, name, options) => {
    const def = groups[group as keyof typeof groups].find((d) => d.name === name)!;
    const args = [name, '--options', options];
    if (name === 'create') args.push('--name', 'test');
    await program(group, def).parseAsync(args, { from: 'user' });
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
  it('rejects whitespace session context before constructing the SDK client', async () => {
    const def = browserCommands.find((d) => d.name === 'get-session')!;
    await program('browser', def).parseAsync(
      ['get-session', '--resource-name', ' ', '--session-id', ' '],
      { from: 'user' },
    );
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});

const invalidFieldCases = cases.flatMap(({ group, definition }) =>
  definition.fields
    .filter((field) => field.kind !== 'string')
    .map((field) => ({ group, definition, field })),
);
describe('every structured CLI field validates its input type', () => {
  it.each(invalidFieldCases)(
    '$group $definition.name rejects invalid $field.key',
    async ({ group, definition, field }) => {
      const args = [
        definition.name,
        ...definition.fields.flatMap((f) => [
          `--${f.flag}`,
          f === field
            ? f.kind === 'number'
              ? 'NaN'
              : f.kind === 'boolean'
                ? 'not-a-boolean'
                : f.kind === 'object'
                  ? '[]'
                  : '{}'
            : typeof value(f) === 'object'
              ? JSON.stringify(value(f))
              : String(value(f)),
        ]),
      ];
      await program(group, definition).parseAsync(args, { from: 'user' });
      expect(mocks.constructor).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );
});

describe('typed SDK options reject unknown keys', () => {
  it.each([
    ['runtime', 'update', '{"descripton":"lost"}', ['--agent-id', 'id']],
    ['runtime', 'update', '{"identityConfig":{}}', ['--agent-id', 'id']],
    [
      'runtime',
      'update-endpoint',
      '{"endpointType":"ignored"}',
      ['--agent-id', 'id', '--endpoint-name', 'default'],
    ],
    ['runtime', 'create', '{"observability_config":{}}', ['--name', 'agent']],
    [
      'identity',
      'get-resource-api-key',
      '{"providerName":"p","workloadAccessToken":"t","ignored":true}',
      [],
    ],
  ] as Array<[keyof typeof groups, string, string, string[]]>)(
    'rejects unknown fields for %s %s',
    async (group, name, options, required) => {
      const def = groups[group].find((d) => d.name === name)!;
      await program(group, def).parseAsync([name, ...required, '--options', options], {
        from: 'user',
      });
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it('preserves arbitrary API extension fields inside SDK extra and Record fields', async () => {
    mocks.client.updateAgent = vi.fn().mockResolvedValue({ id: 'id' });
    const options = {
      description: 'updated',
      extra: { future_field: { enabled: true } },
      networkConfig: { future_network_setting: 42 },
    };
    const def = runtimeCommands.find((d) => d.name === 'update')!;
    await program('runtime', def).parseAsync(
      ['update', '--agent-id', 'id', '--options', JSON.stringify(options)],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(mocks.client.updateAgent).toHaveBeenCalledWith('id', options);
  });
});

const typedArrayCases = [
  ...(['create', 'update', 'upsert'] as const).flatMap((name) =>
    ['envVars', 'tagsConfig'].flatMap((field) =>
      [1, 'text', null, [], false].map((bad) => ({ group: 'runtime', name, field, bad })),
    ),
  ),
  ...[1, 'text', null, [], false].map((bad) => ({
    group: 'identity',
    name: 'get-resource-sts-token',
    field: 'tags',
    bad,
  })),
];
describe('typed SDK option array elements', () => {
  it.each(typedArrayCases)(
    '$group $name rejects $field element $bad',
    async ({ group, name, field, bad }) => {
      const definition = groups[group as keyof typeof groups].find((d) => d.name === name)!;
      const options =
        group === 'identity'
          ? { providerName: 'p', workloadAccessToken: 't', agencySessionName: 's', [field]: [bad] }
          : { [field]: [bad] };
      const required =
        group === 'identity'
          ? []
          : name === 'create'
            ? ['--name', 'agent']
            : name === 'update'
              ? ['--agent-id', 'id']
              : ['--agent-name', 'agent'];
      await program(group, definition).parseAsync(
        [name, ...required, '--options', JSON.stringify(options)],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each([[], [{ arbitrary_api_field: { enabled: true } }]].map((items) => ({ items })))(
    'preserves valid object arrays $items',
    async ({ items }) => {
      const definition = runtimeCommands.find((d) => d.name === 'update')!;
      mocks.client.updateAgent = vi.fn().mockResolvedValue({ id: 'id' });
      const options = { envVars: items, tagsConfig: items };
      await program('runtime', definition).parseAsync(
        ['update', '--agent-id', 'id', '--options', JSON.stringify(options)],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(0);
      expect(mocks.client.updateAgent).toHaveBeenCalledWith('id', options);
    },
  );
  it('preserves valid STS tags and string-array keys', async () => {
    const definition = identityCommands.find((d) => d.name === 'get-resource-sts-token')!;
    mocks.client.getResourceStsToken = vi.fn().mockResolvedValue({});
    const options = {
      providerName: 'p',
      workloadAccessToken: 't',
      agencySessionName: 's',
      tags: [{ key: 'team', value: 'test' }],
      transitiveTagKeys: ['team'],
    };
    await program('identity', definition).parseAsync(
      [definition.name, '--options', JSON.stringify(options)],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(mocks.client.getResourceStsToken).toHaveBeenCalledWith(options);
  });
});

const positionalCases = cases.filter(({ definition }) =>
  definition.fields.some(
    (field) =>
      field.positional && ['browserId', 'profileId', 'codeInterpreterId'].includes(field.key),
  ),
);
describe('explicit positional resource IDs with compatible inputs', () => {
  it.each(positionalCases)(
    '$group $definition.name shows the entity ID in Usage',
    ({ group, definition }) => {
      const field = definition.fields.find((f) => f.positional)!;
      const child = program(group, definition).commands[0];
      expect(child.helpInformation()).toContain(
        `[options] ${definition.sessionPositionals ? '<browserName> <sessionId> ' : ''}<${field.key}>`,
      );
      expect(child.helpInformation()).toContain('Compatibility alias');
      expect(field.required).toBe(true);
    },
  );
  it.each(
    positionalCases.flatMap((row) =>
      ['positional', 'flag', 'file', 'all'].map((source) => ({ ...row, source })),
    ),
  )('$group $definition.name accepts ID from $source', async ({ group, definition, source }) => {
    const field = definition.fields.find((f) => f.positional)!;
    const directory = await mkdtemp(join(tmpdir(), 'agentarts-id-'));
    try {
      const args = [
        definition.name,
        ...(definition.sessionPositionals ? ['resource', 'session'] : []),
      ];
      if (source === 'positional' || source === 'all') args.push('entity-id');
      if (source === 'flag' || source === 'all') args.push(`--${field.flag}`, 'entity-id');
      if (source === 'file' || source === 'all') {
        const file = join(directory, 'request.json');
        await writeFile(file, JSON.stringify({ [field.key]: 'entity-id' }));
        args.push('--request-file', file);
      }
      if (definition.session) args.push('--resource-name', 'resource', '--session-id', 'session');
      if (definition.destructive) args.push('--force');
      mocks.client[definition.method] = vi.fn().mockResolvedValue({ id: 'detail' });
      await program(group, definition).parseAsync(args, { from: 'user' });
      expect(process.exitCode).toBe(0);
      expect(mocks.client[definition.method]).toHaveBeenCalledWith(
        ...definition.fields.map((f) => (f === field ? 'entity-id' : undefined)),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(positionalCases)(
    '$group $definition.name rejects a whitespace positional ID',
    async ({ group, definition }) => {
      await program(group, definition).parseAsync(
        [definition.name, ...(definition.sessionPositionals ? ['resource', 'session'] : []), ' '],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(
    positionalCases.flatMap((row) =>
      ['flag', 'file', 'flag-file'].map((other) => ({ ...row, other })),
    ),
  )(
    '$group $definition.name rejects conflicting $other IDs before confirmation and SDK construction',
    async ({ group, definition, other }) => {
      const field = definition.fields.find((f) => f.positional)!;
      const directory = await mkdtemp(join(tmpdir(), 'agentarts-id-conflict-'));
      try {
        const args = [
          definition.name,
          ...(definition.sessionPositionals ? ['resource', 'session'] : []),
        ];
        if (other !== 'flag-file') args.push('first-id');
        if (other === 'flag' || other === 'flag-file')
          args.push(`--${field.flag}`, other === 'flag' ? 'different-id' : 'first-id');
        if (other === 'file' || other === 'flag-file') {
          const file = join(directory, 'request.json');
          await writeFile(file, JSON.stringify({ [field.key]: 'different-id' }));
          args.push('--request-file', file);
        }
        await program(group, definition).parseAsync(args, { from: 'user' });
        expect(process.exitCode).toBe(1);
        expect(mocks.constructor).not.toHaveBeenCalled();
        expect(mocks.confirm).not.toHaveBeenCalled();
        expect(console.print).toHaveBeenCalledWith(expect.stringContaining('Conflicting IDs'));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

const codeSessionCases = codeInterpreterCommands.filter(
  (d) => d.sessionPositionals || ['startSession', 'getSession'].includes(d.method),
);
function sessionBusinessArgs(definition: OperationCommand) {
  return definition.fields
    .filter(
      (f) => (f.required || f.cliRequired) && !['codeInterpreterName', 'sessionId'].includes(f.key),
    )
    .flatMap((f) => [
      `--${f.flag}`,
      typeof value(f) === 'object' ? JSON.stringify(value(f)) : String(value(f)),
    ]);
}
describe('Code Interpreter explicit name/session command contract', () => {
  it.each(codeSessionCases)('$name displays the required name/session in Usage', (definition) => {
    const command = program('code-interpreter', definition).commands[0];
    expect(command.helpInformation()).toContain(
      `[options] <codeInterpreterName>${definition.method === 'startSession' ? '' : ' <sessionId>'}`,
    );
  });
  it.each(
    codeSessionCases.flatMap((definition) =>
      ['positional', 'canonical-flags', 'legacy-flags', 'file'].map((source) => ({
        definition,
        source,
      })),
    ),
  )(
    '$definition.name accepts $source and preserves the SDK argument/state contract',
    async ({ definition, source }) => {
      const directory = await mkdtemp(join(tmpdir(), 'agentarts-session-'));
      try {
        const args = [definition.name, ...sessionBusinessArgs(definition)];
        if (source === 'positional')
          args.push('tool', ...(definition.method === 'startSession' ? [] : ['session']));
        else if (source === 'file') {
          const file = join(directory, 'request.json');
          await writeFile(
            file,
            JSON.stringify({
              codeInterpreterName: 'tool',
              ...(definition.method === 'startSession' ? {} : { sessionId: 'session' }),
            }),
          );
          args.push('--request-file', file);
        } else {
          args.push(
            source === 'legacy-flags' && definition.sessionPositionals
              ? '--resource-name'
              : '--code-interpreter-name',
            'tool',
          );
          if (definition.method !== 'startSession') args.push('--session-id', 'session');
        }
        if (definition.destructive) args.push('--force');
        mocks.client[definition.method] = vi.fn().mockResolvedValue({ ok: true });
        await program('code-interpreter', definition).parseAsync(args, { from: 'user' });
        expect(process.exitCode).toBe(0);
        expect(mocks.client[definition.method]).toHaveBeenCalledWith(
          ...definition.fields.map((f) =>
            f.key === 'codeInterpreterName'
              ? 'tool'
              : f.key === 'sessionId'
                ? 'session'
                : f.required || f.cliRequired
                  ? value(f)
                  : undefined,
          ),
        );
        if (definition.sessionPositionals) {
          expect(mocks.client.codeInterpreterName).toBe('tool');
          expect(mocks.client.sessionId).toBe('session');
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it.each(codeSessionCases)(
    '$name rejects missing name before creating a client',
    async (definition) => {
      await program('code-interpreter', definition).parseAsync(
        [
          definition.name,
          ...sessionBusinessArgs(definition),
          ...(definition.method === 'startSession' ? [] : ['--session-id', 'session']),
        ],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(codeSessionCases.filter((d) => d.method !== 'startSession'))(
    '$name rejects missing session ID before creating a client',
    async (definition) => {
      await program('code-interpreter', definition).parseAsync(
        [definition.name, 'tool', ...sessionBusinessArgs(definition)],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(codeSessionCases)('$name rejects conflicting resource names', async (definition) => {
    await program('code-interpreter', definition).parseAsync(
      [
        definition.name,
        'tool',
        ...(definition.method === 'startSession' ? [] : ['session']),
        ...sessionBusinessArgs(definition),
        '--code-interpreter-name',
        'other',
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each(codeSessionCases.filter((d) => d.method !== 'startSession'))(
    '$name rejects conflicting session IDs',
    async (definition) => {
      await program('code-interpreter', definition).parseAsync(
        [
          definition.name,
          'tool',
          'session',
          ...sessionBusinessArgs(definition),
          '--session-id',
          'other',
        ],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(codeSessionCases.filter((d) => d.sessionPositionals))(
    '$name rejects conflicting canonical and legacy name flags',
    async (definition) => {
      await program('code-interpreter', definition).parseAsync(
        [
          definition.name,
          ...sessionBusinessArgs(definition),
          '--code-interpreter-name',
          'tool',
          '--resource-name',
          'other',
          '--session-id',
          'session',
        ],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
});

const browserSessionCases = browserCommands.filter(
  (d) => d.sessionPositionals || d.method === 'startSession',
);
const browserBusinessFields = (d: OperationCommand) =>
  d.fields.filter((f) => (f.required || f.cliRequired) && f.key !== 'browserName');
const browserBusinessFlags = (d: OperationCommand) =>
  browserBusinessFields(d).flatMap((f) => [
    `--${f.flag}`,
    typeof value(f) === 'object' ? JSON.stringify(value(f)) : String(value(f)),
  ]);
describe('all Browser command identifiers', () => {
  it.each(browserCommands)('$name shows its SDK-required resource/session identifiers', (d) => {
    const usage = program('browser', d).commands[0].helpInformation().split('\n')[0];
    if (d.sessionPositionals) expect(usage).toContain('<browserName> <sessionId>');
    for (const f of d.fields.filter((f) => f.positional))
      expect(usage).toContain(f.required || f.cliRequired ? `<${f.key}>` : `[${f.key}]`);
    if (['list', 'list-profiles'].includes(d.name)) expect(usage).not.toContain('<browserName>');
  });
  it.each(
    browserSessionCases.flatMap((definition) =>
      ['positional', 'canonical', 'legacy', 'file'].map((source) => ({ definition, source })),
    ),
  )(
    '$definition.name routes $source names/session IDs without changing SDK arguments',
    async ({ definition: d, source }) => {
      const dir = await mkdtemp(join(tmpdir(), 'agentarts-browser-session-'));
      try {
        const args = [d.name];
        if (source === 'positional') {
          args.push(
            'browser',
            ...(d.sessionPositionals ? ['session'] : []),
            ...d.fields
              .filter(
                (f) => f.positional && f.key !== 'browserName' && (f.required || f.cliRequired),
              )
              .map((f) => String(value(f))),
          );
          args.push(
            ...browserBusinessFields(d)
              .filter((f) => !f.positional)
              .flatMap((f) => [
                `--${f.flag}`,
                typeof value(f) === 'object' ? JSON.stringify(value(f)) : String(value(f)),
              ]),
          );
        } else {
          args.push(...browserBusinessFlags(d));
          if (source === 'file') {
            const file = join(dir, 'request.json');
            await writeFile(
              file,
              JSON.stringify({
                browserName: 'browser',
                ...(d.sessionPositionals ? { sessionId: 'session' } : {}),
              }),
            );
            args.push('--request-file', file);
          } else {
            args.push(
              source === 'legacy' && d.sessionPositionals ? '--resource-name' : '--browser-name',
              'browser',
            );
            if (d.sessionPositionals) args.push('--session-id', 'session');
          }
        }
        if (d.destructive) args.push('--force');
        mocks.client[d.method] = vi.fn().mockResolvedValue({ ok: true });
        await program('browser', d).parseAsync(args, { from: 'user' });
        expect(process.exitCode).toBe(0);
        expect(mocks.client[d.method]).toHaveBeenCalledWith(
          ...d.fields.map((f) =>
            f.key === 'browserName'
              ? 'browser'
              : f.required || f.cliRequired
                ? value(f)
                : undefined,
          ),
        );
        if (d.sessionPositionals) {
          expect(mocks.client.browserName).toBe('browser');
          expect(mocks.client.sessionId).toBe('session');
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it.each(browserSessionCases)('$name rejects missing browser name', async (d) => {
    await program('browser', d).parseAsync(
      [
        d.name,
        ...browserBusinessFlags(d),
        ...(d.sessionPositionals ? ['--session-id', 'session'] : []),
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
  });
  it.each(browserSessionCases.filter((d) => d.sessionPositionals))(
    '$name rejects missing session ID',
    async (d) => {
      await program('browser', d).parseAsync([d.name, 'browser', ...browserBusinessFlags(d)], {
        from: 'user',
      });
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(browserSessionCases)('$name rejects conflicting browser names', async (d) => {
    await program('browser', d).parseAsync(
      [
        d.name,
        'browser',
        ...(d.sessionPositionals ? ['session'] : []),
        ...browserBusinessFlags(d),
        '--browser-name',
        'other',
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it.each(browserSessionCases.filter((d) => d.sessionPositionals))(
    '$name rejects conflicting session IDs',
    async (d) => {
      await program('browser', d).parseAsync(
        [d.name, 'browser', 'session', ...browserBusinessFlags(d), '--session-id', 'other'],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(1);
      expect(mocks.constructor).not.toHaveBeenCalled();
    },
  );
  it.each(['create', 'create-profile'])(
    '%s accepts a positional name and preserves --name compatibility',
    async (name) => {
      const d = browserCommands.find((d) => d.name === name)!;
      mocks.client[d.method] = vi.fn().mockResolvedValue({ name: 'browser' });
      await program('browser', d).parseAsync([name, 'browser'], { from: 'user' });
      expect(process.exitCode).toBe(0);
      expect(mocks.client[d.method]).toHaveBeenCalledWith(
        ...d.fields.map((f) => (f.key === 'name' ? 'browser' : undefined)),
      );
    },
  );
});

describe('Browser resource positional plus explicit session compatibility', () => {
  it.each(['flags', 'file'])(
    'preserves save-profile PROFILE_ID with %s context',
    async (source) => {
      const dir = await mkdtemp(join(tmpdir(), 'agentarts-profile-context-'));
      try {
        const d = browserCommands.find((d) => d.name === 'save-profile')!;
        mocks.client.saveProfile = vi.fn().mockResolvedValue({ ok: true });
        const args = ['save-profile', 'profile'];
        if (source === 'flags') args.push('--resource-name', 'browser', '--session-id', 'session');
        else {
          const file = join(dir, 'request.json');
          await writeFile(file, JSON.stringify({ browserName: 'browser', sessionId: 'session' }));
          args.push('--request-file', file);
        }
        await program('browser', d).parseAsync(args, { from: 'user' });
        expect(process.exitCode).toBe(0);
        expect(mocks.client.saveProfile).toHaveBeenCalledWith('profile', undefined);
        expect(mocks.client.browserName).toBe('browser');
        expect(mocks.client.sessionId).toBe('session');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
  it('preserves canonical partial positionals with an explicit profile ID option', async () => {
    const d = browserCommands.find((d) => d.name === 'save-profile')!;
    mocks.client.saveProfile = vi.fn().mockResolvedValue({ ok: true });
    await program('browser', d).parseAsync(
      ['save-profile', 'browser', '--session-id', 'session', '--profile-id', 'profile'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(mocks.client.saveProfile).toHaveBeenCalledWith('profile', undefined);
    expect(mocks.client.browserName).toBe('browser');
  });
});

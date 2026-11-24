/** Fail when a new SDK business method is added without a toolkit mapping. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { identityCommands } from 'agentarts-sdk/toolkit/cli/identity/resources';
import { browserCommands } from 'agentarts-sdk/toolkit/cli/browser/resources';
import { codeInterpreterCommands } from 'agentarts-sdk/toolkit/cli/code-interpreter/resources';
import { iamCommands } from 'agentarts-sdk/toolkit/cli/iam/resources';
import { swrCommands } from 'agentarts-sdk/toolkit/cli/swr/resources';
import { runtimeCommands } from 'agentarts-sdk/toolkit/cli/runtime/resources';
import { buildProgram } from 'agentarts-sdk/toolkit/main';

function methods(file: string, className: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(resolve('packages/agentarts-sdk/src/sdk', file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find(
    (n) => ts.isClassDeclaration(n) && n.name?.text === className,
  ) as ts.ClassDeclaration;
  return [
    ...new Set(
      declaration.members
        .filter(
          (m) =>
            ts.isMethodDeclaration(m) &&
            !m.modifiers?.some((mod) =>
              [
                ts.SyntaxKind.PrivateKeyword,
                ts.SyntaxKind.ProtectedKeyword,
                ts.SyntaxKind.StaticKeyword,
              ].includes(mod.kind),
            ),
        )
        .map((m) => m.name!.getText(source))
        .filter((name) => !name.startsWith('_')),
    ),
  ];
}
const rows = [
  [
    'service/identity/identity-client.ts',
    'IdentityClient',
    identityCommands.map((d) => d.method),
    [],
  ],
  [
    'tools/browser/browser-client.ts',
    'Browser',
    browserCommands.map((d) => d.method),
    ['generateAutomationUrl', 'generateLiveViewUrl'],
  ],
  [
    'tools/code_interpreter/code-interpreter-client.ts',
    'CodeInterpreter',
    codeInterpreterCommands.map((d) => d.method),
    [],
  ],
  ['service/iam-client.ts', 'IAMClient', iamCommands.map((d) => d.method), []],
  ['service/swr-client.ts', 'SWRClient', swrCommands.map((d) => d.method), ['getFullImageName']],
  [
    'service/runtime-client.ts',
    'RuntimeClient',
    [
      ...runtimeCommands.filter((d) => d.method !== 'pingAgent').map((d) => d.method),
      'invokeAgent',
      'execCommand',
      'uploadFiles',
      'downloadFiles',
      'stopSession',
      'startSession',
    ],
    ['setAuthToken'],
  ],
  ['service/runtime-client.ts', 'LocalRuntimeClient', ['invokeAgent', 'pingAgent'], []],
  [
    'gateway/gateway-client.ts',
    'GatewayClient',
    [
      'createGateway',
      'updateGateway',
      'deleteGateway',
      'getGateway',
      'listGateways',
      'createGatewayTarget',
      'updateGatewayTarget',
      'deleteGatewayTarget',
      'getGatewayTarget',
      'listGatewayTargets',
    ],
    [],
  ],
  [
    'memory/client.ts',
    'MemoryClient',
    [
      'createSpace',
      'getSpace',
      'listSpaces',
      'updateSpace',
      'deleteSpace',
      'createMemory',
      'updateMemory',
      'createMemorySession',
      'listSessions',
      'deleteSession',
      'getSession',
      'getLastKMessages',
      'getMessage',
      'addMessages',
      'listMessages',
      'searchMemories',
      'listMemories',
      'getMemory',
      'deleteMemory',
    ],
    ['close'],
  ],
] as Array<[string, string, string[], string[]]>;

describe('whole SDK command coverage', () => {
  it.each(rows)(
    '%s %s has a mapping for every business method',
    (file, className, mapped, helpers) => {
      expect(
        methods(file, className)
          .filter((name) => !helpers.includes(name))
          .sort(),
      ).toEqual([...mapped].sort());
    },
  );
  it('registers new groups in the main program without duplicate command names', () => {
    const root = buildProgram();
    for (const name of [
      'memory',
      'gateway',
      'runtime',
      'identity',
      'browser',
      'code-interpreter',
      'iam',
      'swr',
    ])
      expect(root.commands.some((c) => c.name() === name)).toBe(true);
    const visit = (command: typeof root) => {
      const names = command.commands.map((c) => c.name());
      expect(new Set(names).size, command.name()).toBe(names.length);
      command.commands.forEach(visit);
    };
    visit(root);
  });
  it('keeps SDK calls out of the newly added CLI implementation layers', () => {
    for (const group of ['identity', 'browser', 'code-interpreter', 'iam', 'swr', 'runtime']) {
      const content = readFileSync(
        resolve(`packages/agentarts-sdk/src/toolkit/cli/${group}/resources.ts`),
        'utf8',
      );
      expect(content).not.toMatch(
        /new (IdentityClient|Browser|CodeInterpreter|IAMClient|SWRClient|RuntimeClient)\(/,
      );
      expect(content).toContain(`operations/${group}/index.js`);
    }
  });
});

const signatures: Array<[string, string, typeof browserCommands]> = [
  ['service/identity/identity-client.ts', 'IdentityClient', identityCommands],
  ['tools/browser/browser-client.ts', 'Browser', browserCommands],
  ['tools/code_interpreter/code-interpreter-client.ts', 'CodeInterpreter', codeInterpreterCommands],
  ['service/iam-client.ts', 'IAMClient', iamCommands],
  ['service/swr-client.ts', 'SWRClient', swrCommands],
  [
    'service/runtime-client.ts',
    'RuntimeClient',
    runtimeCommands.filter((d) => d.method !== 'pingAgent'),
  ],
];
describe('CLI parameter contracts against actual SDK source', () => {
  it.each(signatures)(
    '%s %s preserves parameter order, names, types and optionality',
    (file, className, commands) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(resolve('packages/agentarts-sdk/src/sdk', file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const declaration = source.statements.find(
        (n) => ts.isClassDeclaration(n) && n.name?.text === className,
      ) as ts.ClassDeclaration;
      for (const command of commands) {
        const method = declaration.members.find(
          (m) => ts.isMethodDeclaration(m) && m.name.getText(source) === command.method,
        ) as ts.MethodDeclaration;
        expect(
          command.fields.map((f) => ({ key: f.key, required: f.required })),
          command.method,
        ).toEqual(
          method.parameters.map((p) => ({
            key: p.name.getText(source),
            required: !p.questionToken && !p.initializer,
          })),
        );
        method.parameters.forEach((parameter, index) => {
          const type =
            parameter.type?.getText(source) ?? parameter.initializer?.getText(source) ?? '';
          const kind = /\[\]|Array</.test(type)
            ? 'array'
            : /^(number|[0-9])/.test(type)
              ? 'number'
              : /^(boolean|true|false)/.test(type)
                ? 'boolean'
                : /^(string|['"])/.test(type)
                  ? 'string'
                  : undefined;
          if (kind)
            expect(
              command.fields[index].kind,
              command.method + '.' + parameter.name.getText(source),
            ).toBe(kind);
        });
      }
    },
  );
});

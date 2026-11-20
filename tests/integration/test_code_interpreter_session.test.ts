/**
 * Code Interpreter billable sandbox session (RUN_BILLABLE tier).
 *
 * Ported 1:1 from `tests/integration/test_code_interpreter_session.py`.
 *
 * Starts a real sandbox session against a *pre-provisioned* code interpreter via
 * the `codeSession` context-manager equivalent (auto-stops on exit → no session
 * residue), runs code + a shell command, round-trips a file (upload→download),
 * and clears context. Costs real money; gated behind
 * `AGENTARTS_TEST_RUN_BILLABLE=1`, `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY`
 * and `AGENTARTS_TEST_CODE_INTERPRETER_NAME`.
 *
 * All operations happen inside one session to minimise billable sessions.
 */

import { describe, it, expect } from 'vitest';

import { codeSession } from 'agentarts-sdk';

import {
  cloudRegion,
  codeInterpreterApiKey,
  codeInterpreterName,
  hasCloudCredentials,
  runBillable,
} from './_helpers.js';

const API_KEY = codeInterpreterApiKey();
const INTERPRETER_NAME = codeInterpreterName();
const describeSession =
  hasCloudCredentials() && runBillable() && API_KEY && INTERPRETER_NAME
    ? describe
    : describe.skip;

const FILE_PATH = '/home/user/aa-it-uploaded.txt';
const FILE_CONTENT = 'hello-aa-it';

describeSession('code interpreter session (RUN_BILLABLE tier)', () => {
  it('runs the full sandbox workflow inside one codeSession', async () => {
    const interpreterName = INTERPRETER_NAME as string;
    const session = codeSession(cloudRegion(), interpreterName, 'API_KEY', API_KEY as string);

    // `session.enter()` is the `with code_session(...) as client:` counterpart;
    // `session.exit()` (in `finally`) stops the sandbox.
    const client = await session.enter();
    try {
      // 1. executeCode
      const codeResult = await client.executeCode('print(1 + 1)');
      expect(typeof codeResult).toBe('object');
      expect(JSON.stringify(codeResult)).toContain('2');

      // 1b. executeCode (typescript) — same session, native TS execution.
      // Type annotations are rejected by the Python kernel, so a passing
      // result proves the service really ran the TypeScript path.
      const tsResult = await client.executeCode(
        'const n: number = 41;\nconsole.log(n + 1);',
        'typescript',
      );
      expect(typeof tsResult).toBe('object');
      expect(JSON.stringify(tsResult)).toContain('42');

      // 2. executeCommand (shell)
      const commandResult = await client.executeCommand(`echo ${FILE_CONTENT}`);
      expect(typeof commandResult).toBe('object');

      // 3. uploadFile then downloadFile (round-trip)
      const uploaded = await client.uploadFile(FILE_PATH, FILE_CONTENT);
      expect(typeof uploaded).toBe('object');
      const downloaded = await client.downloadFile(FILE_PATH);
      const text = typeof downloaded === 'string' ? downloaded : downloaded.toString('utf8');
      expect(text).toContain(FILE_CONTENT);

      // 4. getSession
      const sessionInfo = await client.getSession(interpreterName);
      expect(typeof sessionInfo).toBe('object');

      // 5. clearContext
      const cleared = await client.clearContext();
      expect(typeof cleared).toBe('object');
    } finally {
      await session.exit();
    }
  });
});

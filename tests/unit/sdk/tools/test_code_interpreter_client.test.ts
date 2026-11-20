/**
 * Tests for `CodeInterpreter` (code interpreter client).
 *
 * Ported 1:1 from `tests/unit/sdk/tools/test_code_interpreter_client.py`.
 *
 * Python patches module-level helpers (`agentarts.sdk.utils.constant.*`,
 * `os.getenv`) because its clients resolve endpoints and credentials eagerly.
 * The Node.js clients are side-effect-free constructors, so the port only
 * stubs the data/control plane HTTP methods with `vi.spyOn` and controls the
 * API Key through `process.env` (`vi.stubEnv`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ControlToolsHttpClient, DataToolsHttpClient } from 'agentarts-sdk/sdk/service/tools-http';
import {
  CodeInterpreter,
  DEFAULT_TIMEOUT,
  codeSession,
  withCodeSession,
} from 'agentarts-sdk/sdk/tools/code_interpreter';

const ENV_API_KEY = 'HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY';
const API_KEY = 'test-api-key';

const CODE_INTERPRETER_NAME = 'test-code-interpreter-name';
const SESSION_ID = 'test-session-id';

/** PNG magic header, mirrors Python's `b"\x89PNG\r\n\x1a\n"`. */
const BINARY_CONTENT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BINARY_CONTENT_B64 = Buffer.from(BINARY_CONTENT).toString('base64');

let client: CodeInterpreter;

beforeEach(() => {
  // Unit tests must never reach the network (PORTING.md §10).
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('unexpected fetch call'))),
  );
  vi.stubEnv(ENV_API_KEY, API_KEY);
  client = new CodeInterpreter('test-region');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Mark the client as having an active session (Python sets the attributes). */
function markSession(
  name: string = CODE_INTERPRETER_NAME,
  sessionId: string = SESSION_ID,
): void {
  client.codeInterpreterName = name;
  client.sessionId = sessionId;
}

/** Spy on `DataToolsHttpClient.invoke`, returning a canned response. */
function spyInvoke(result: Record<string, any> = { result: 'success' }) {
  return vi.spyOn(DataToolsHttpClient.prototype, 'invoke').mockResolvedValue(result);
}

type InvokeSpy = ReturnType<typeof spyInvoke>;

/** Assert the single `invoke` call made through an active API_KEY session. */
function expectInvoke(
  spy: InvokeSpy,
  operateType: string,
  args: Record<string, any>,
): void {
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith(
    CODE_INTERPRETER_NAME,
    SESSION_ID,
    { operate_type: operateType, arguments: args },
    API_KEY,
  );
}

// ============================================================
// TestCodeInterpreterClient
// ============================================================

describe('TestCodeInterpreterClient', () => {
  // ── Control plane: create / list / update / get / delete ──────────

  it('create code interpreter with required params', async () => {
    const responseData = {
      name: 'test-code-interpreter-name',
      api_key_name: 'test-api-key-name',
      description: 'test-code-interpreter-description',
      auth_type: 'API_KEY',
      execution_agency_name: 'test-execution-agency-name',
      observability: {},
      network_config: {},
      agent_gateway_id: 'test-agent-gateway-id',
      tags: [],
    };
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue(responseData);

    const result = await client.createCodeInterpreter(
      'test-code-interpreter-name',
      'API_KEY',
      'test-api-key-name',
    );

    expect(result).toEqual(responseData);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      name: 'test-code-interpreter-name',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
    });
  });

  it('create code interpreter with api key', async () => {
    const responseData = {
      name: 'test-code-interpreter-name',
      api_key_name: 'test-api-key-name',
      description: 'test-code-interpreter-description',
      auth_type: 'API_KEY',
      execution_agency_name: 'test-execution-agency-name',
      observability: {},
      network_config: {},
      agent_gateway_id: 'test-agent-gateway-id',
      tags: [],
    };
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue(responseData);

    const result = await client.createCodeInterpreter(
      'test-code-interpreter-name',
      'API_KEY',
      'test-api-key-name',
    );

    expect(result).toEqual(responseData);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      name: 'test-code-interpreter-name',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
    });
  });

  it('create code interpreter with iam', async () => {
    const responseData = {
      name: 'test-code-interpreter-name',
      api_key_name: 'test-api-key-name',
      description: 'test-code-interpreter-description',
      auth_type: 'IAM',
      execution_agency_name: 'test-execution-agency-name',
      observability: {},
      network_config: {},
      agent_gateway_id: 'test-agent-gateway-id',
      tags: [],
    };
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue(responseData);

    const result = await client.createCodeInterpreter('test-code-interpreter-name', 'IAM');

    expect(result).toEqual(responseData);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      name: 'test-code-interpreter-name',
      auth_type: 'IAM',
    });
  });

  it('create code interpreter with all params', async () => {
    const observability = {
      logs: {
        enable: true,
        group_id: 'test-group-id',
        stream_id: 'test-stream-id',
      },
      metrics: { enable: true, instance_id: 'test-instance-id' },
      tracing: { enable: true, service_group: 'test-service-group' },
    };
    const networkConfig = { network_config: 'PUBLIC' };
    const tags = [{ key: 'test-tag', value: 'test-tag-value' }];
    const responseData = {
      name: 'test-code-interpreter-name',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      description: 'test-code-interpreter-description',
      execution_agency_name: 'test-execution-agency-name',
      observability,
      network_config: networkConfig,
      agent_gateway_id: 'test-agent-gateway-id',
      tags,
    };
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue(responseData);

    const result = await client.createCodeInterpreter(
      'test-code-interpreter-name',
      'API_KEY',
      'test-api-key-name',
      'test-code-interpreter-description',
      'test-execution-agency-name',
      observability,
      networkConfig,
      'test-agent-gateway-id',
      tags,
    );

    expect(result).toEqual(responseData);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      name: 'test-code-interpreter-name',
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      description: 'test-code-interpreter-description',
      execution_agency_name: 'test-execution-agency-name',
      observability,
      network_config: networkConfig,
      agent_gateway_id: 'test-agent-gateway-id',
      tags,
    });
  });

  it('list code interpreters with default params', async () => {
    const responseData = {
      total_count: 1,
      items: [{ name: 'test-code-interpreter-name', api_key_name: 'test-api-key-name' }],
    };
    const listSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'listCodeInterpreters')
      .mockResolvedValue(responseData);

    const result = await client.listCodeInterpreters();

    expect(result).toEqual(responseData);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith({ limit: 10, offset: 0 });
  });

  it('list code interpreters with all params', async () => {
    const responseData = {
      total_count: 1,
      items: [{ name: 'test-code-interpreter-name', api_key_name: 'test-api-key-name' }],
    };
    const listSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'listCodeInterpreters')
      .mockResolvedValue(responseData);

    const result = await client.listCodeInterpreters(
      'test-name',
      20,
      10,
      'created_at',
      'asc',
    );

    expect(result).toEqual(responseData);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith({
      name: 'test-name',
      limit: 20,
      offset: 10,
      sort_key: 'created_at',
      sort_dir: 'asc',
    });
  });

  it('list code interpreters with tag params', async () => {
    const responseData = {
      total_count: 1,
      items: [{ name: 'test-code-interpreter-name', api_key_name: 'test-api-key-name' }],
    };
    const listSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'listCodeInterpreters')
      .mockResolvedValue(responseData);

    const result = await client.listCodeInterpreters(
      'test-name',
      20,
      10,
      'created_at',
      'asc',
      ['env', 'project'],
      ['env', 'project'],
      ['production', 'alpha'],
      'ALL',
    );

    expect(result).toEqual(responseData);
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy).toHaveBeenCalledWith({
      name: 'test-name',
      limit: 20,
      offset: 10,
      sort_key: 'created_at',
      sort_dir: 'asc',
      tag_key_exists: ['env', 'project'],
      tag_key_matches: ['env', 'project'],
      tag_value_matches: ['production', 'alpha'],
      tag_match_policy: 'ALL',
    });
  });

  it('list code interpreters tag key exists exceeds 10', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, Array.from({ length: 11 }, (_, i) => `key${i}`)),
    ).rejects.toThrow('tag_key_exists supports up to 10 items');
  });

  it('list code interpreters tag key exists has duplicates', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, ['env', 'project', 'env']),
    ).rejects.toThrow('tag_key_exists must not contain duplicate items');
  });

  it('list code interpreters tag key exceeds 128 chars', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, ['a'.repeat(129)]),
    ).rejects.toThrow('tag_key must not exceed 128 characters');
  });

  it('list code interpreters tag matches missing partner', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, null, ['env']),
    ).rejects.toThrow('tag_key_matches and tag_value_matches must be used together');
  });

  it('list code interpreters tag value matches missing partner', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, null, null, ['production']),
    ).rejects.toThrow('tag_key_matches and tag_value_matches must be used together');
  });

  it('list code interpreters tag matches length mismatch', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, null, ['env', 'project'], ['production']),
    ).rejects.toThrow('tag_key_matches and tag_value_matches must have the same length');
  });

  it('list code interpreters tag matches exceeds 10', async () => {
    await expect(
      client.listCodeInterpreters(
        null,
        10,
        0,
        null,
        null,
        null,
        Array.from({ length: 11 }, (_, i) => `key${i}`),
        Array.from({ length: 11 }, (_, i) => `value${i}`),
      ),
    ).rejects.toThrow('tag_key_matches supports up to 10 items');
  });

  it('list code interpreters tag matches duplicate key', async () => {
    await expect(
      client.listCodeInterpreters(
        null,
        10,
        0,
        null,
        null,
        null,
        ['env', 'project', 'env'],
        ['production', 'alpha', 'beta'],
      ),
    ).rejects.toThrow('tag_key_matches must not contain duplicate items');
  });

  it('list code interpreters tag matches duplicate value', async () => {
    await expect(
      client.listCodeInterpreters(
        null,
        10,
        0,
        null,
        null,
        null,
        ['env', 'project'],
        ['production', 'production'],
      ),
    ).rejects.toThrow('tag_value_matches must not contain duplicate items');
  });

  it('list code interpreters tag matches empty string', async () => {
    await expect(
      client.listCodeInterpreters(
        null,
        10,
        0,
        null,
        null,
        null,
        ['env', ''],
        ['production', 'alpha'],
      ),
    ).rejects.toThrow('tag_key_matches does not support empty strings');
  });

  it('list code interpreters tag value exceeds 255 chars', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, null, ['env'], ['a'.repeat(256)]),
    ).rejects.toThrow('tag_value must not exceed 255 characters');
  });

  it('list code interpreters tag match policy invalid', async () => {
    await expect(
      client.listCodeInterpreters(null, 10, 0, null, null, null, null, null, 'INVALID'),
    ).rejects.toThrow("tag_match_policy must be either 'ALL' or 'ANY'");
  });

  it('update code interpreter', async () => {
    const observability = {
      logs: {
        enable: true,
        group_id: 'test-group-id',
        stream_id: 'test-stream-id',
      },
      metrics: { enable: true, instance_id: 'test-instance-id' },
      tracing: { enable: true, service_group: 'test-service-group' },
    };
    const tags = [{ key: 'test-tag', value: 'test-tag-value' }];
    const responseData = {
      id: 'test-code-interpreter-id',
      name: 'test-code-interpreter-name',
      description: 'test-code-interpreter-description',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      execution_agency_name: 'test-execution-agency-name',
      agent_gateway_id: 'test-agent-gateway-id',
      workload_identity: { urn: 'test-workload-urn' },
      access_endpoint: 'test-access-endpoint-url',
      observability,
      tags,
    };
    const updateSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'updateCodeInterpreter')
      .mockResolvedValue(responseData);

    const result = await client.updateCodeInterpreter(
      'test-code-interpreter-id',
      observability,
      tags,
    );

    expect(result).toEqual(responseData);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('test-code-interpreter-id', {
      observability,
      tags,
    });
  });

  it('get code interpreter', async () => {
    const responseData = {
      id: 'test-code-interpreter-id',
      name: 'test-code-interpreter-name',
      description: 'test-code-interpreter-description',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      execution_agency_name: 'test-execution-agency-name',
      observability: {
        logs: {
          enable: true,
          group_id: 'test-group-id',
          stream_id: 'test-stream-id',
        },
        metrics: { enable: true, instance_id: 'test-instance-id' },
        tracing: { enable: true, service_group: 'test-service-group' },
      },
      workload_identity: { urn: 'test-workload-urn' },
      access_endpoint: 'test-access-endpoint-url',
      agent_gateway_id: 'test-agent-gateway-id',
      tags: [{ key: 'test-tag', value: 'test-tag-value' }],
      auth_type: 'API_KEY',
      api_key_name: 'test-api-key-name',
      network_config: {
        vpc_id: 'test-vpc-id',
        subnet_id: 'test-subnet-id',
        security_group_id: ['test-security-group-id'],
      },
    };
    const getSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'getCodeInterpreter')
      .mockResolvedValue(responseData);
    const codeInterpreterId = 'test-code-interpreter-id';

    const result = await client.getCodeInterpreter(codeInterpreterId);

    expect(result).toEqual(responseData);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(codeInterpreterId);
  });

  it('delete code interpreter', async () => {
    const deleteSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'deleteCodeInterpreter')
      .mockResolvedValue(undefined);
    const codeInterpreterId = 'test-code-interpreter-id';

    await client.deleteCodeInterpreter(codeInterpreterId);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith(codeInterpreterId);
  });

  // ── Data plane: session lifecycle ────────────────────────────────

  it('start session with default params', async () => {
    const testSessionId = 'test-session-id';
    const startSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'startSession')
      .mockResolvedValue({ session_id: testSessionId });

    const result = await client.startSession(CODE_INTERPRETER_NAME, 'test-session-name');

    expect(result).toBe(testSessionId);
    expect(client.sessionId).toBe(testSessionId);
    expect(client.codeInterpreterName).toBe(CODE_INTERPRETER_NAME);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(
      'test-code-interpreter-name',
      { name: 'test-session-name', session_timeout: DEFAULT_TIMEOUT },
      API_KEY,
    );
  });

  it('start session with custom params', async () => {
    const testSessionId = 'test-session-id';
    const testApiKey = 'custom-api-key';
    const testSessionTimeout = 3600;
    const startSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'startSession')
      .mockResolvedValue({ session_id: testSessionId });

    const result = await client.startSession(
      CODE_INTERPRETER_NAME,
      'test-session-name',
      testApiKey,
      testSessionTimeout,
    );

    expect(result).toBe(testSessionId);
    expect(client.sessionId).toBe(testSessionId);
    expect(client.codeInterpreterName).toBe(CODE_INTERPRETER_NAME);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith(
      'test-code-interpreter-name',
      { name: 'test-session-name', session_timeout: testSessionTimeout },
      testApiKey,
    );
  });

  it('get session with custom params', async () => {
    const sessionId = 'test-session-id';
    const codeInterpreterName = 'test-code-interpreter-name';
    const responseData = {
      code_interpreter_name: codeInterpreterName,
      session_id: sessionId,
      created_at: '2023-01-01T00:00:00Z',
      name: 'test-session-name',
      session_timeout: 900,
    };
    const getSessionSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'getSession')
      .mockResolvedValue(responseData);

    const response = await client.getSession(codeInterpreterName, sessionId);

    expect(response).toEqual(responseData);
    expect(getSessionSpy).toHaveBeenCalledTimes(1);
    expect(getSessionSpy).toHaveBeenCalledWith(codeInterpreterName, sessionId, API_KEY);
  });

  it('get session with no params', async () => {
    const errorMessage = 'code_interpreter_name and session_id are required';

    await expect(client.getSession('test-code-interpreter-name')).rejects.toThrow(errorMessage);
  });

  it('stop session with session exists', async () => {
    markSession();
    const stopSpy = vi
      .spyOn(DataToolsHttpClient.prototype, 'stopSession')
      .mockResolvedValue({});

    await client.stopSession();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith('test-code-interpreter-name', 'test-session-id', API_KEY);
  });

  it('stop session with no activate', async () => {
    const result = await client.stopSession();

    expect(result).toBe(true);
    expect(client.sessionId).toBeNull();
    expect(client.codeInterpreterName).toBeNull();
  });

  it('invoke with no existing session', async () => {
    const errorMessage =
      'No Code Interpreter exists, use create_code_interpreter method first';

    await expect(client.invoke('test-method', {})).rejects.toThrow(errorMessage);
  });

  it('invoke with existing session', async () => {
    const invokeSpy = spyInvoke();
    markSession();

    await client.invoke('test-method', {});

    expectInvoke(invokeSpy, 'test-method', {});
  });

  // ── Data plane: execute code / command ───────────────────────────

  it('execute code with python', async () => {
    const code = "print('Hello, World!')";
    const invokeSpy = spyInvoke();
    markSession();

    await client.executeCode(code);

    expectInvoke(invokeSpy, 'execute_code', {
      code,
      language: 'python',
      clear_context: false,
    });
  });

  it('execute code with clear context', async () => {
    const code = "print('Hello, World!')";
    const invokeSpy = spyInvoke();
    markSession();

    await client.executeCode(code, 'python', true);

    expectInvoke(invokeSpy, 'execute_code', {
      code,
      language: 'python',
      clear_context: true,
    });
  });

  it('execute code with typescript', async () => {
    const code = 'const x: number = 1;\nconsole.log(x + 1);';
    const invokeSpy = spyInvoke();
    markSession();

    await client.executeCode(code, 'typescript', true);

    expectInvoke(invokeSpy, 'execute_code', {
      code,
      language: 'typescript',
      clear_context: true,
    });
  });

  it('execute code with invalid language', async () => {
    const code = "console.log('Hello, World!')";
    markSession();
    const errorMessage = 'Invalid language. Supported languages are: python, typescript';

    // `javascript` is rejected by the service too, so it stays invalid here.
    await expect(client.executeCode(code, 'javascript')).rejects.toThrow(errorMessage);
    await expect(client.executeCode(code, 'ruby')).rejects.toThrow(errorMessage);
  });

  it('execute command with valid command', async () => {
    const command = 'ls -la';
    const invokeSpy = spyInvoke();
    markSession();

    await client.executeCommand(command);

    expectInvoke(invokeSpy, 'execute_command', { command });
  });

  it('execute command with invalid command', async () => {
    const command = '^ls -la';
    markSession();
    const errorMessage = 'Invalid command format';

    await expect(client.executeCommand(command)).rejects.toThrow(errorMessage);
  });

  // ── Data plane: upload ───────────────────────────────────────────

  it('upload file with text content', async () => {
    const invokeSpy = spyInvoke();
    markSession();
    const path = '/home/user/test.txt';
    const textContent = 'Hello, World!';
    const description = 'test file';

    await client.uploadFile(path, textContent, description);

    expectInvoke(invokeSpy, 'write_files', {
      write_contents: [{ path, text: textContent }],
    });
  });

  it('upload file with binary content', async () => {
    const invokeSpy = spyInvoke();
    markSession();
    const path = '/home/user/image.jpg';
    const description = 'test file';

    await client.uploadFile(path, BINARY_CONTENT, description);

    expectInvoke(invokeSpy, 'write_files', {
      write_contents: [{ path, blob: BINARY_CONTENT_B64 }],
    });
  });

  it('upload file with relative path', async () => {
    const invokeSpy = spyInvoke();
    markSession();
    const path = 'test.txt';
    const textContent = 'Hello, World!';
    const description = 'test file';

    await client.uploadFile(path, textContent, description);

    expectInvoke(invokeSpy, 'write_files', {
      write_contents: [{ path: '/home/user/test.txt', text: textContent }],
    });
  });

  it('upload files with mixed content', async () => {
    const invokeSpy = spyInvoke();
    markSession();
    const files = [
      {
        path: '/home/user/test.txt',
        content: 'Hello, World!',
      },
      {
        path: '/home/user/image.jpg',
        content: BINARY_CONTENT,
      },
    ];

    await client.uploadFiles(files);

    expectInvoke(invokeSpy, 'write_files', {
      write_contents: [
        { path: '/home/user/test.txt', text: 'Hello, World!' },
        { path: '/home/user/image.jpg', blob: BINARY_CONTENT_B64 },
      ],
    });
  });

  it('upload files with invalid path', async () => {
    markSession();
    const errorMessage = 'Invalid path. Path must start with /home/user';
    const files = [
      {
        path: '/invalid/user/test.txt',
        content: 'Hello, World!',
      },
      {
        path: '/home/user/image.jpg',
        content: BINARY_CONTENT,
      },
    ];

    await expect(client.uploadFiles(files)).rejects.toThrow(errorMessage);
  });

  // ── Data plane: download ─────────────────────────────────────────

  it('download file with text content', async () => {
    const textContent = 'col1, col2\n1, 2\n3, 4';
    const invokeSpy = spyInvoke({
      result: {
        content: [
          {
            type: 'resource',
            resource: {
              type: 'text',
              uri: 'file:///home/user/data.csv',
              text: textContent,
            },
          },
        ],
      },
    });
    markSession();
    const path = '/home/user/data.csv';

    const response = await client.downloadFile(path);

    expectInvoke(invokeSpy, 'read_files', { paths: [path] });
    expect(response).toBe(textContent);
  });

  it('download file with binary content', async () => {
    const invokeSpy = spyInvoke({
      result: {
        content: [
          {
            type: 'resource',
            resource: {
              type: 'blob',
              uri: 'file:///home/user/image.png',
              blob: BINARY_CONTENT_B64,
            },
          },
        ],
      },
    });
    markSession();
    const path = '/home/user/image.png';

    const response = await client.downloadFile(path);

    expectInvoke(invokeSpy, 'read_files', { paths: [path] });
    expect(Buffer.isBuffer(response)).toBe(true);
    expect((response as Buffer).equals(Buffer.from(BINARY_CONTENT))).toBe(true);
  });

  it('download file with no found file', async () => {
    spyInvoke({});
    markSession();
    const path = '/home/user/no-existent.csv';
    const errorMessage = `Could not read file: ${path}`;

    await expect(client.downloadFile(path)).rejects.toThrow(errorMessage);
  });

  it('download file with invalid path', async () => {
    markSession();
    const path = '/var/invalid.csv';
    const errorMessage = 'Invalid path. Path must start with /home/user';

    await expect(client.downloadFile(path)).rejects.toThrow(errorMessage);
  });

  it('download files with text files', async () => {
    const invokeSpy = spyInvoke({
      result: {
        content: [
          {
            type: 'resource',
            resource: {
              type: 'text',
              uri: 'file:///home/user/data.csv',
              text: 'col1, col2\n1, 2\n3, 4',
            },
          },
          {
            type: 'resource',
            resource: {
              type: 'text',
              uri: 'file:///home/user/config.json',
              text: '{"key": "value"}',
            },
          },
        ],
      },
    });
    markSession();
    const paths = ['/home/user/data.csv', '/home/user/config.json'];

    const result = await client.downloadFiles(paths);

    expectInvoke(invokeSpy, 'read_files', { paths });
    expect(result).toEqual({
      '/home/user/data.csv': 'col1, col2\n1, 2\n3, 4',
      '/home/user/config.json': '{"key": "value"}',
    });
  });

  it('download files with binary files', async () => {
    const invokeSpy = spyInvoke({
      result: {
        content: [
          {
            type: 'resource',
            resource: {
              type: 'blob',
              uri: 'file:///home/user/iamge-1.png',
              blob: BINARY_CONTENT_B64,
            },
          },
          {
            type: 'resource',
            resource: {
              type: 'blob',
              uri: 'file:///home/user/image-2.png',
              blob: BINARY_CONTENT_B64,
            },
          },
        ],
      },
    });
    markSession();
    const paths = ['/home/user/iamge-1.png', '/home/user/image-2.png'];

    const result = await client.downloadFiles(paths);

    expectInvoke(invokeSpy, 'read_files', { paths });
    expect(Object.keys(result).sort()).toEqual([
      '/home/user/iamge-1.png',
      '/home/user/image-2.png',
    ]);
    for (const value of Object.values(result)) {
      expect(Buffer.isBuffer(value)).toBe(true);
      expect((value as Buffer).equals(Buffer.from(BINARY_CONTENT))).toBe(true);
    }
  });

  it('download files with invalid path', async () => {
    markSession();
    const paths = ['/var/user/data.csv', '/var/user/config.json'];
    const errorMessage = 'Invalid path. Path must start with /home/user';

    await expect(client.downloadFiles(paths)).rejects.toThrow(errorMessage);
  });

  // ── Data plane: packages and context ─────────────────────────────

  it('install packages', async () => {
    const packages = ['pandas'];
    const invokeSpy = spyInvoke();
    markSession();

    await client.installPackages(packages);

    expectInvoke(invokeSpy, 'execute_command', {
      command: `pip install ${packages.join(' ')} `,
    });
  });

  it('install packages with version', async () => {
    const packages = ['pandas>=2.0'];
    const invokeSpy = spyInvoke();
    markSession();

    await client.installPackages(packages);

    expectInvoke(invokeSpy, 'execute_command', {
      command: `pip install ${packages.join(' ')} `,
    });
  });

  it('install packages with upgrade', async () => {
    const packages = ['pandas'];
    const invokeSpy = spyInvoke();
    markSession();

    await client.installPackages(packages, true);

    expectInvoke(invokeSpy, 'execute_command', {
      command: `pip install ${packages.join(' ')} --upgrade`,
    });
  });

  it('install packages with invalid package', async () => {
    markSession();
    const invalidPackage = ['pandas&&'];
    const errorMessage = `Invalid package name: ${invalidPackage[0]}`;

    await expect(client.installPackages(invalidPackage)).rejects.toThrow(errorMessage);
  });

  it('clear context', async () => {
    const invokeSpy = spyInvoke();
    markSession();

    await client.clearContext();

    expectInvoke(invokeSpy, 'execute_code', {
      code: '# Context cleared',
      language: 'python',
      clear_context: true,
    });
  });
});

// ============================================================
// TestCodeInterpreterNameValidation
// ============================================================

describe('TestCodeInterpreterNameValidation', () => {
  it('valid name min length', async () => {
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue({ name: 'ab' });

    const result = await client.createCodeInterpreter('ab', 'IAM');

    expect(result['name']).toBe('ab');
    expect(createSpy).toHaveBeenCalledWith({ name: 'ab', auth_type: 'IAM' });
  });

  it('valid name max length', async () => {
    const maxName = 'a' + 'b'.repeat(38) + 'c'; // 40 chars
    const createSpy = vi
      .spyOn(ControlToolsHttpClient.prototype, 'createCodeInterpreter')
      .mockResolvedValue({ name: maxName });

    const result = await client.createCodeInterpreter(maxName, 'IAM');

    expect(result['name']).toBe(maxName);
    expect(createSpy).toHaveBeenCalledWith({ name: maxName, auth_type: 'IAM' });
  });

  it('invalid name too short', async () => {
    await expect(client.createCodeInterpreter('a', 'IAM')).rejects.toThrow('2-40 characters');
  });

  it('invalid name too long', async () => {
    const longName = 'a' + 'b'.repeat(40) + 'c'; // 42 chars

    await expect(client.createCodeInterpreter(longName, 'IAM')).rejects.toThrow('2-40 characters');
  });

  it('invalid name starts with digit', async () => {
    await expect(client.createCodeInterpreter('1test-code', 'IAM')).rejects.toThrow(
      'start with lowercase letter',
    );
  });

  it('invalid name ends with hyphen', async () => {
    await expect(client.createCodeInterpreter('test-code-', 'IAM')).rejects.toThrow(
      'end with lowercase letter or digit',
    );
  });

  it('invalid name uppercase', async () => {
    await expect(client.createCodeInterpreter('TestCode', 'IAM')).rejects.toThrow('lowercase');
  });
});

// ============================================================
// CodeSession — the Node.js form of Python's `with code_session(...)`
// ============================================================
//
// Python only exercises `code_session` in the integration suite; the Node.js
// session object is covered here because its `enter()`/`exit()`/async-iterator
// contract replaces the Python context manager.

describe('CodeSession (codeSession / withCodeSession)', () => {
  it('codeSession starts the default session on enter and stops it on exit', async () => {
    const startSpy = vi
      .spyOn(CodeInterpreter.prototype, 'startSession')
      .mockResolvedValue('s-1');
    const stopSpy = vi
      .spyOn(CodeInterpreter.prototype, 'stopSession')
      .mockResolvedValue(true);

    const session = codeSession('cn-southwest-2', 'my-ci');
    const codeInterpreter = await session.enter();

    expect(codeInterpreter).toBe(session.client);
    expect(codeInterpreter).toBeInstanceOf(CodeInterpreter);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledWith('my-ci', 'default-session-name', null);

    await session.exit();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith(null);
  });

  it('codeSession forwards apiKey and verifySsl', async () => {
    const startSpy = vi
      .spyOn(CodeInterpreter.prototype, 'startSession')
      .mockResolvedValue('s-1');
    vi.spyOn(CodeInterpreter.prototype, 'stopSession').mockResolvedValue(true);

    const session = codeSession('cn-southwest-2', 'my-ci', 'API_KEY', 'my-key', false);
    await session.enter();

    expect(startSpy).toHaveBeenCalledWith('my-ci', 'default-session-name', 'my-key');

    const codeInterpreter = session.client as any;
    expect(codeInterpreter.controlPlaneClient._config.verifySsl).toBe(false);
    expect(codeInterpreter.dataPlaneClient._config.verifySsl).toBe(false);
    expect(codeInterpreter.dataPlaneClient.openAkSk).toBe(false);
  });

  it('codeSession enter starts the session only once', async () => {
    const session = codeSession('cn-southwest-2', 'my-ci');
    const startSpy = vi
      .spyOn(CodeInterpreter.prototype, 'startSession')
      .mockImplementation(async () => {
        // The real implementation caches the session id on the client.
        session.client.sessionId = 's-1';
        return 's-1';
      });
    vi.spyOn(CodeInterpreter.prototype, 'stopSession').mockResolvedValue(true);

    await session.enter();
    await session.enter();

    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('codeSession supports for await and stops the session afterwards', async () => {
    const startSpy = vi
      .spyOn(CodeInterpreter.prototype, 'startSession')
      .mockResolvedValue('s-1');
    const stopSpy = vi
      .spyOn(CodeInterpreter.prototype, 'stopSession')
      .mockResolvedValue(true);

    const session = codeSession('cn-southwest-2', 'my-ci');
    const seen: CodeInterpreter[] = [];
    for await (const codeInterpreter of session) {
      seen.push(codeInterpreter);
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(stopSpy).not.toHaveBeenCalled();
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(session.client);
    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledWith(null);
  });

  it('withCodeSession runs the callback and stops the session', async () => {
    const startSpy = vi
      .spyOn(CodeInterpreter.prototype, 'startSession')
      .mockResolvedValue('s-1');
    const stopSpy = vi
      .spyOn(CodeInterpreter.prototype, 'stopSession')
      .mockResolvedValue(true);

    const result = await withCodeSession('cn-southwest-2', 'my-ci', async (codeInterpreter) => {
      expect(codeInterpreter).toBeInstanceOf(CodeInterpreter);
      expect(startSpy).toHaveBeenCalledTimes(1);
      return 'done';
    });

    expect(result).toBe('done');
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('withCodeSession stops the session when the callback throws', async () => {
    vi.spyOn(CodeInterpreter.prototype, 'startSession').mockResolvedValue('s-1');
    const stopSpy = vi
      .spyOn(CodeInterpreter.prototype, 'stopSession')
      .mockResolvedValue(true);

    await expect(
      withCodeSession('cn-southwest-2', 'my-ci', async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});

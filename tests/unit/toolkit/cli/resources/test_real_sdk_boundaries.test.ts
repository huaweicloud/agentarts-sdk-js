/** Exercise real SDK methods; replace only the final cloud transport. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupLogging } from 'agentarts-sdk/sdk/utils/logging';
import { IdentityClient } from 'agentarts-sdk/sdk/service/identity/identity-client';
import { SWRClient } from 'agentarts-sdk/sdk/service/swr-client';
import {
  ControlBrowserHttpClient,
  ControlToolsHttpClient,
  DataToolsHttpClient,
  DataBrowserHttpClient,
} from 'agentarts-sdk/sdk/service/tools-http';
import { createResourceCommand as browser } from 'agentarts-sdk/toolkit/cli/browser/resources';
import { CodeInterpreter } from 'agentarts-sdk/sdk/tools/code_interpreter/code-interpreter-client';
import { createResourceCommand as identity } from 'agentarts-sdk/toolkit/cli/identity/resources';
import { createResourceCommand as swr } from 'agentarts-sdk/toolkit/cli/swr/resources';
import { createResourceCommand as code } from 'agentarts-sdk/toolkit/cli/code-interpreter/resources';
import { getResourceOauth2Token as getOauthToken } from 'agentarts-sdk/toolkit/operations/identity/index';
import { console as output } from 'agentarts-sdk/toolkit/utils/common';

beforeEach(() => {
  process.exitCode = 0;
  setupLogging('INFO');
});
afterEach(() => {
  process.exitCode = 0;
  setupLogging(null);
});

describe('Identity JSON to wire model conversion', () => {
  it('serializes camelCase user identifiers to the wire format', async () => {
    let body: any;
    vi.spyOn(IdentityClient.prototype as any, '_ensureClient').mockResolvedValue({
      completeResourceTokenAuth: vi.fn(async (request: any) => {
        body = request.body.toDict();
        return {};
      }),
    });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await identity().parseAsync(
      [
        'complete-resource-token-auth',
        '--session-uri',
        'session-uri',
        '--user-identifier',
        '{"userId":"user","userToken":"dummy-token"}',
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(body).toEqual({
      session_uri: 'session-uri',
      user_identifier: { user_id: 'user', user_token: 'dummy-token' },
    });
  });
  it('recursively serializes custom OAuth discovery metadata', async () => {
    let body: any;
    vi.spyOn(IdentityClient.prototype as any, '_ensureClient').mockResolvedValue({
      createOauth2CredentialProvider: vi.fn(async (request: any) => {
        body = request.body.toDict();
        return { credentialProvider: { name: 'provider' } };
      }),
    });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await identity().parseAsync(
      [
        'create-oauth2-credential-provider',
        '--name',
        'provider',
        '--vendor',
        'CustomOauth2',
        '--client-id',
        'client',
        '--client-secret',
        'dummy-secret',
        '--oauth-discovery',
        JSON.stringify({
          discoveryUrl: 'https://example.invalid/discovery',
          authorizationServerMetadata: {
            issuer: 'https://example.invalid',
            authorizationEndpoint: 'https://example.invalid/auth',
            tokenEndpoint: 'https://example.invalid/token',
            responseTypes: ['code'],
            tokenEndpointAuthMethods: ['client_secret_post'],
          },
        }),
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(
      body.oauth2_provider_config_input.custom_oauth2_provider_config.oauth2_discovery,
    ).toEqual({
      discovery_url: 'https://example.invalid/discovery',
      authorization_server_metadata: {
        issuer: 'https://example.invalid',
        authorization_endpoint: 'https://example.invalid/auth',
        token_endpoint: 'https://example.invalid/token',
        response_types: ['code'],
        token_endpoint_auth_methods: ['client_secret_post'],
      },
    });
  });
});

describe('real SDK output and session behavior', () => {
  it('keeps SWR JSON stdout parseable while sending SDK diagnostics to stderr', async () => {
    vi.spyOn(SWRClient.prototype as any, '_getClient').mockResolvedValue({
      createNamespace: vi.fn().mockResolvedValue({}),
      showNamespace: vi.fn().mockResolvedValue({ id: 1, name: 'test' }),
    });
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any) => {
      stdout += String(chunk);
      return true;
    }) as any);
    try {
      await swr().parseAsync(['create-organization', '--organization', 'test', '-o', 'json'], {
        from: 'user',
      });
    } finally {
      write.mockRestore();
    }
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ id: 1, name: 'test' });
    expect(diagnostics).toHaveBeenCalledWith(expect.stringContaining('Created SWR organization'));
  });
  it.each(['hello\nworld', '', Buffer.from([0, 255, 128])])(
    'writes downloaded content without JSON encoding: %j',
    async (content) => {
      // Keep downloadFile itself real; replace the final data-plane invocation.
      vi.spyOn(CodeInterpreter.prototype, 'invoke').mockResolvedValue({
        result: {
          content: [
            typeof content === 'string'
              ? { type: 'text', text: content }
              : { type: 'image', data: content.toString('base64') },
          ],
        },
      });
      const directory = await mkdtemp(join(tmpdir(), 'agentarts-review-download-'));
      try {
        const file = join(directory, 'download');
        await code().parseAsync(
          [
            'download-file',
            '--path',
            '/home/user/file',
            '--resource-name',
            'tool',
            '--session-id',
            'session',
            '--output-file',
            file,
          ],
          { from: 'user' },
        );
        expect(process.exitCode).toBe(0);
        expect(await readFile(file)).toEqual(Buffer.from(content));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it('requires an explicit session ID before constructing a fresh SDK client', async () => {
    const sdk = vi.spyOn(CodeInterpreter.prototype, 'getSession');
    vi.spyOn(output, 'print').mockImplementation(() => undefined);
    await code().parseAsync(['get-session', '--code-interpreter-name', 'tool'], { from: 'user' });
    expect(process.exitCode).toBe(1);
    expect(sdk).not.toHaveBeenCalled();
  });
  it('gets an existing session using the SDK parameter names and explicit ID', async () => {
    const sdk = vi
      .spyOn(CodeInterpreter.prototype, 'getSession')
      .mockImplementation(async function (this: CodeInterpreter, name, id) {
        expect(this.sessionId).toBeNull();
        return { name, id };
      });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await code().parseAsync(
      ['get-session', '--code-interpreter-name', 'tool', '--session-id', 'session'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(sdk).toHaveBeenCalledWith('tool', 'session', undefined);
  });
});

describe('private credential output files', () => {
  it.each([false, true])(
    'restricts output permissions for an existing file=%s',
    async (existing) => {
      vi.spyOn(IdentityClient.prototype as any, '_ensureClient').mockResolvedValue({
        getResourceApiKeyInvoker: () => ({
          withRetry() {
            return this;
          },
          invoke: async () => ({ apiKey: 'dummy-key' }),
        }),
      });
      const directory = await mkdtemp(join(tmpdir(), 'agentarts-private-output-'));
      const file = join(directory, 'credential.json');
      try {
        if (existing) {
          await writeFile(file, 'previous content that must be fully replaced');
          await chmod(file, 0o644);
        }
        await identity().parseAsync(
          [
            'get-resource-api-key',
            '--options',
            '{"providerName":"provider","workloadAccessToken":"dummy-token"}',
            '--output-file',
            file,
          ],
          { from: 'user' },
        );
        expect(process.exitCode).toBe(0);
        expect(JSON.parse(await readFile(file, 'utf8'))).toBe('dummy-key');
        if (process.platform !== 'win32') expect((await stat(file)).mode & 0o777).toBe(0o600);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});

describe('positional IDs reach real SDK details methods', () => {
  it('passes browserId through SDK validation to the control-plane transport', async () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    const transport = vi
      .spyOn(ControlBrowserHttpClient.prototype, 'getBrowser')
      .mockResolvedValue({ id });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await browser().parseAsync(['get', id], { from: 'user' });
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith(id);
  });
  it('passes codeInterpreterId to the SDK control-plane transport', async () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    const transport = vi
      .spyOn(ControlToolsHttpClient.prototype, 'getCodeInterpreter')
      .mockResolvedValue({ id });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await code().parseAsync(['get', id], { from: 'user' });
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith(id);
  });
});

describe('positional session context reaches the real SDK', () => {
  it('starts a session using the interpreter name rather than a resource UUID', async () => {
    const transport = vi
      .spyOn(DataToolsHttpClient.prototype, 'startSession')
      .mockResolvedValue({ session_id: 'session' });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await code().parseAsync(
      ['start-session', 'my-tool', '--session-name', 'work', '--session-auth-type', 'IAM'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith('my-tool', { name: 'work', session_timeout: 900 });
  });
  it('executes code with an explicit name and session restored in a new client', async () => {
    const transport = vi
      .spyOn(DataToolsHttpClient.prototype, 'invoke')
      .mockResolvedValue({ ok: true });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await code().parseAsync(
      ['execute-code', 'my-tool', 'session', '--code', 'print(1)', '--session-auth-type', 'IAM'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith('my-tool', 'session', {
      operate_type: 'execute_code',
      arguments: { code: 'print(1)', language: 'python', clear_context: false },
    });
  });
});

describe('Browser positional session routing through real SDK', () => {
  it('starts a browser session by browser name', async () => {
    const transport = vi
      .spyOn(DataBrowserHttpClient.prototype, 'startSession')
      .mockResolvedValue({ browser_name: 'my-browser', session_id: 'session' });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await browser().parseAsync(
      ['start-session', 'my-browser', '--session-name', 'work', '--session-auth-type', 'IAM'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith(
      'my-browser',
      expect.objectContaining({ name: 'work' }),
      null,
    );
  });
  it('navigates using restored browser name/session ID', async () => {
    const transport = vi
      .spyOn(DataBrowserHttpClient.prototype, 'invoke')
      .mockResolvedValue({ ok: true });
    vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
    await browser().parseAsync(
      [
        'navigate',
        'my-browser',
        'session',
        '--url',
        'https://example.com',
        '--session-auth-type',
        'IAM',
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(0);
    expect(transport).toHaveBeenCalledWith('my-browser', 'session', 'navigate', {
      url: 'https://example.com',
    });
  });
  it('switch-tab requires an explicit tab ID', async () => {
    const transport = vi
      .spyOn(DataBrowserHttpClient.prototype, 'invoke')
      .mockResolvedValue({ ok: true });
    vi.spyOn(output, 'print').mockImplementation(() => undefined);
    await browser().parseAsync(
      ['switch-tab', 'my-browser', 'session', '--session-auth-type', 'IAM'],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([undefined, 'tab-1'])(
    'close-tab preserves the SDK optional current-tab behavior: %s',
    async (tab) => {
      const transport = vi
        .spyOn(DataBrowserHttpClient.prototype, 'invoke')
        .mockResolvedValue({ ok: true });
      vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
      await browser().parseAsync(
        ['close-tab', 'my-browser', 'session', ...(tab ? [tab] : []), '--session-auth-type', 'IAM'],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(0);
      expect(transport).toHaveBeenCalledWith(
        'my-browser',
        'session',
        'close_tab',
        tab ? { tab_id: tab } : {},
      );
    },
  );
});

describe('latest SDK language support through Code Interpreter CLI', () => {
  it.each(['python', 'typescript'])(
    'forwards %s through the real SDK executeCode method',
    async (language) => {
      const transport = vi
        .spyOn(DataToolsHttpClient.prototype, 'invoke')
        .mockResolvedValue({ ok: true });
      vi.spyOn(output, 'printPlain').mockImplementation(() => undefined);
      const source =
        language === 'typescript'
          ? 'const total: number = 1 + 1; console.log(total);'
          : 'print(1 + 1)';
      await code().parseAsync(
        [
          'execute-code',
          'my-tool',
          'session',
          '--code',
          source,
          '--language',
          language,
          '--session-auth-type',
          'IAM',
        ],
        { from: 'user' },
      );
      expect(process.exitCode).toBe(0);
      expect(transport).toHaveBeenCalledWith('my-tool', 'session', {
        operate_type: 'execute_code',
        arguments: { code: source, language, clear_context: false },
      });
    },
  );
  it('rejects javascript before sending a data-plane request', async () => {
    const transport = vi.spyOn(DataToolsHttpClient.prototype, 'invoke');
    vi.spyOn(output, 'print').mockImplementation(() => undefined);
    await code().parseAsync(
      [
        'execute-code',
        'my-tool',
        'session',
        '--code',
        'console.log(1)',
        '--language',
        'javascript',
        '--session-auth-type',
        'IAM',
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(transport).not.toHaveBeenCalled();
    expect(output.print).toHaveBeenCalledWith(expect.stringContaining('python, typescript'));
  });
});

describe('programmatic Identity Operations preserve SDK callback contracts', () => {
  it('accepts callbacks and custom token pollers without mutating caller options', async () => {
    const callback = vi.fn();
    const poller = { pollForToken: async () => 'dummy-token' };
    const sdk = vi
      .spyOn(IdentityClient.prototype, 'getResourceOauth2Token')
      .mockImplementation(async (options) => {
        options.onAuthUrl?.('https://example.invalid/auth');
        return 'dummy-token';
      });
    const input = {
      providerName: 'provider',
      workloadAccessToken: 'dummy-workload',
      authFlow: 'USER_FEDERATION' as const,
      onAuthUrl: callback,
      tokenPoller: poller,
    };
    const result = await getOauthToken([input]);
    expect(result.success).toBe(true);
    expect(callback).toHaveBeenCalledWith('https://example.invalid/auth');
    expect(sdk).toHaveBeenCalledWith(
      expect.objectContaining({ onAuthUrl: callback, tokenPoller: poller }),
    );
    expect(input.onAuthUrl).toBe(callback);
    expect(input.tokenPoller).toBe(poller);
  });
  it('allows an explicit toolkit callback to override the SDK callback', async () => {
    const original = vi.fn(),
      override = vi.fn();
    const sdk = vi
      .spyOn(IdentityClient.prototype, 'getResourceOauth2Token')
      .mockResolvedValue('dummy-token');
    await getOauthToken(
      [
        {
          providerName: 'provider',
          workloadAccessToken: 'dummy-workload',
          authFlow: 'M2M',
          onAuthUrl: original,
        },
      ],
      { onAuthUrl: override },
    );
    expect(sdk).toHaveBeenCalledWith(expect.objectContaining({ onAuthUrl: override }));
  });
  it.each(['onAuthUrl', 'tokenPoller'])('rejects JSON %s at the CLI boundary', async (key) => {
    const sdk = vi.spyOn(IdentityClient.prototype, 'getResourceOauth2Token');
    vi.spyOn(output, 'print').mockImplementation(() => undefined);
    await identity().parseAsync(
      [
        'get-resource-oauth2-token',
        '--options',
        JSON.stringify({
          providerName: 'provider',
          workloadAccessToken: 'dummy-workload',
          authFlow: 'M2M',
          [key]: {},
        }),
      ],
      { from: 'user' },
    );
    expect(process.exitCode).toBe(1);
    expect(sdk).not.toHaveBeenCalled();
    expect(output.print).toHaveBeenCalledWith(
      expect.stringContaining('cannot be supplied as JSON'),
    );
  });
});

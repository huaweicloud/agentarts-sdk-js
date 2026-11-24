/**
 * Unit tests for the runtime client.
 *
 * Ported 1:1 from `tests/unit/sdk/service/test_runtime_client.py`.
 *
 * Python patches `RuntimeClient._data` / `requests.Session.request`; the port
 * spies on the same client methods and stubs the global `fetch` for the
 * streaming-download path. Tar fixtures are built as real tar headers here
 * (Python used `tarfile`) since only the `ustar` magic at offset 257 matters.
 */

import { mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  RuntimeClient,
  StreamDownloadResult,
  isTarPayload,
  uploadContentType,
} from 'agentarts-sdk/sdk/service/runtime-client';
import { RequestResult, SignMode } from 'agentarts-sdk/sdk/service/http-client';

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const TAR_MAGIC_OFFSET = 257;

const tempDirs: string[] = [];

/** Create a scratch directory that is removed after the test. */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agentarts-runtime-client-'));
  tempDirs.push(dir);
  return dir;
}

/** Write a file into a fresh scratch directory and return its path. */
function tempFile(name: string, data: string | Uint8Array): string {
  const path = join(tempDir(), name);
  writeFileSync(path, data);
  return path;
}

/**
 * Build a minimal 1024-byte tar archive (header + one data block).
 *
 * `variant` selects the magic/version bytes: POSIX ustar (`ustar\0` + `00`),
 * GNU (`ustar  \0`) or PAX (ustar, like Python's `tarfile.PAX_FORMAT`).
 */
function makeTarBytes(variant: 'ustar' | 'gnu' | 'pax' = 'ustar'): Buffer {
  const buffer = Buffer.alloc(1024, 0);
  buffer.write('inside.txt', 0, 'utf8');
  buffer.write('0000644\0', 100, 'latin1');
  buffer.write('0000000\0', 108, 'latin1');
  buffer.write('0000000\0', 116, 'latin1');
  buffer.write('00000000011\0', 124, 'latin1'); // size 9 ("hello tar")
  buffer.write('00000000000\0', 136, 'latin1');
  if (variant === 'gnu') {
    buffer.write('ustar  \0', TAR_MAGIC_OFFSET, 'latin1');
  } else {
    buffer.write('ustar\0', TAR_MAGIC_OFFSET, 'latin1');
    buffer.write('00', 263, 'latin1');
  }
  buffer.write('hello tar', 512, 'utf8');
  return buffer;
}

/** Write a tar archive to `path` using the requested format. */
function writeTar(path: string, variant: 'ustar' | 'gnu' | 'pax' = 'ustar'): void {
  writeFileSync(path, makeTarBytes(variant));
}

/** A `RequestResult` with the given wire fields. */
function makeResult(init: {
  success: boolean;
  statusCode?: number;
  data?: any;
  error?: string | null;
  headers?: Record<string, string>;
  streaming?: boolean;
}): RequestResult {
  return new RequestResult({
    success: init.success,
    statusCode: init.statusCode ?? 200,
    data: init.data ?? null,
    error: init.error ?? null,
    headers: init.headers ?? {},
    streaming: init.streaming ?? false,
  });
}

/** Global `fetch` replacement returning a fixed response. */
function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** A streaming HTTP response whose body yields exactly `chunks`. */
function streamResponse(
  chunks: Uint8Array[],
  contentType: string,
  status = 200,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'content-type': contentType },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================
// Tar detection
// ============================================================

describe('TestTarDetection', () => {
  it('suffix detected', () => {
    const path = tempFile('payload.tar', Buffer.alloc(10, 0));

    expect(isTarPayload(path)).toBe(true);
    expect(uploadContentType(path)).toBe('application/x-tar');
  });

  it('gnu magic without suffix', () => {
    const path = join(tempDir(), 'payload.gnu');
    writeTar(path, 'gnu');

    expect(isTarPayload(path)).toBe(true);
    expect(uploadContentType(path)).toBe('application/x-tar');
  });

  it('pax magic without suffix', () => {
    const path = join(tempDir(), 'payload.pax');
    writeTar(path, 'pax');

    expect(isTarPayload(path)).toBe(true);
  });

  it('non tar is octet stream', () => {
    const path = tempFile('notes.txt', 'plain text');

    expect(isTarPayload(path)).toBe(false);
    expect(uploadContentType(path)).toBe('application/octet-stream');
  });

  it('compressed tarball not misdetected', () => {
    const path = tempFile('payload.tar.gz', gzipSync(Buffer.from('not a raw tar')));

    expect(isTarPayload(path)).toBe(false);
    expect(uploadContentType(path)).toBe('application/octet-stream');
  });

  it('in memory tar content', () => {
    const content = makeTarBytes();

    expect(isTarPayload(null, content)).toBe(true);
    expect(uploadContentType(null, content)).toBe('application/x-tar');
  });

  it('short content is not tar', () => {
    // `hello` (5 bytes) is what the v11 signing tests upload; it must stay
    // octet-stream so those wire-level signing assertions still hold.
    expect(isTarPayload(null, Buffer.from('hello'), 'f.txt')).toBe(false);
    expect(uploadContentType(null, Buffer.from('hello'), 'f.txt')).toBe(
      'application/octet-stream',
    );
  });
});

// ============================================================
// Lifecycle configuration
// ============================================================

describe('TestRuntimeClientLifecycleConfig', () => {
  it('create agent includes lifecycle config', async () => {
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });
    const lifecycleConfig = { idle_session_timeout_sec: 600, max_alive_time_sec: 3600 };

    const control = vi
      .spyOn(client, '_control')
      .mockResolvedValue(makeResult({ success: true, data: { id: 'agent-1' } }));
    vi.spyOn(RuntimeClient, '_check').mockReturnValue({ id: 'agent-1' });

    await client.createAgent('test-agent', { lifecycleConfig });

    const options = control.mock.calls[0][2]!;
    expect(options.json['lifecycle_config']).toEqual(lifecycleConfig);
  });

  it('update agent includes lifecycle config', async () => {
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });
    const lifecycleConfig = { idle_session_timeout_sec: 900 };

    const control = vi
      .spyOn(client, '_control')
      .mockResolvedValue(makeResult({ success: true, data: { id: 'agent-1' } }));
    vi.spyOn(RuntimeClient, '_check').mockReturnValue({ id: 'agent-1' });

    await client.updateAgent('agent-1', { lifecycleConfig });

    const options = control.mock.calls[0][2]!;
    expect(options.json['lifecycle_config']).toEqual(lifecycleConfig);
  });

  it('lifecycle config none is omitted', async () => {
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    const control = vi
      .spyOn(client, '_control')
      .mockResolvedValue(makeResult({ success: true, data: { id: 'agent-1' } }));
    vi.spyOn(RuntimeClient, '_check').mockReturnValue({ id: 'agent-1' });

    await client.createAgent('test-agent', { lifecycleConfig: null });

    const options = control.mock.calls[0][2]!;
    expect(options.json).not.toHaveProperty('lifecycle_config');
  });

  it('upsert forwards lifecycle config to create and update', async () => {
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });
    const lifecycleConfig = { max_alive_time_sec: 86400 };

    const findFirst = vi.spyOn(client, 'findAgentByName').mockResolvedValue(null);
    const create = vi.spyOn(client, 'createAgent').mockResolvedValue({ id: 'agent-1' });
    await client.createOrUpdateAgent('test-agent', { lifecycleConfig });
    expect(create.mock.calls[0][1]!.lifecycleConfig).toEqual(lifecycleConfig);
    expect(findFirst).toHaveBeenCalledOnce();

    findFirst.mockResolvedValue({ id: 'agent-1' });
    const update = vi.spyOn(client, 'updateAgent').mockResolvedValue({ id: 'agent-1' });
    await client.createOrUpdateAgent('test-agent', { lifecycleConfig });
    expect(update.mock.calls[0][1]!.lifecycleConfig).toEqual(lifecycleConfig);
  });
});

// ============================================================
// exec_command
// ============================================================

describe('TestRuntimeClientExecCommand', () => {
  it('exec command basic', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: true,
        statusCode: 200,
        data: { stdout: 'file1.txt\nfile2.txt', stderr: '' },
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = (await client.execCommand('test-agent', 'session-123', [
      'ls',
      '-la',
    ])) as Record<string, any>;

    expect(typeof result).toBe('object');
    expect(result['stdout']).toBe('file1.txt\nfile2.txt');

    expect(data.mock.calls[0][0]).toBe('POST');
    expect(data.mock.calls[0][1]).toBe('/runtimes/test-agent/commands');
  });

  it('exec command with chunked header', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: true,
        statusCode: 200,
        data: { result: 'ok' },
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.execCommand('test-agent', 'session-123', ['echo', 'hello'], { chunked: true });

    const options = data.mock.calls[0][2]!;
    expect(options.headers?.['Command-Type']).toBe('chunked');
  });

  it('exec command command as array', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: true,
        statusCode: 200,
        data: { stdout: '' },
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.execCommand('test-agent', 'session-123', ['ls', '-la', '/home']);

    const options = data.mock.calls[0][2]!;
    expect(options.json['command']).toEqual(['ls', '-la', '/home']);
  });

  it('exec command with bearer token', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: true,
        statusCode: 200,
        data: { stdout: '' },
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await client.execCommand('test-agent', 'session-123', ['pwd'], {
      bearerToken: 'test-token',
    });

    const options = data.mock.calls[0][2]!;
    expect(options.headers?.['Authorization']).toBe('Bearer test-token');
  });

  it('exec command failure raises error', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: false,
        statusCode: 500,
        error: 'Internal Server Error',
        data: null,
      }),
    );

    await expect(
      client.execCommand('test-agent', 'session-123', ['ls']),
    ).rejects.toThrow(/exec_command failed/);
  });
});

// ============================================================
// upload_files
// ============================================================

describe('TestRuntimeClientUploadFiles', () => {
  it('upload files single file streaming', async () => {
    const path = tempFile('test.txt', 'test content');

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const binary = vi
      .spyOn(client, '_dataBinary')
      .mockResolvedValue(makeResult({ success: true, statusCode: 200, data: { status: 'uploaded' } }));

    const result = await client.uploadFiles('test-agent', 'session-123', [
      { path: '/home/user/test.txt', localFile: path },
    ]);

    expect(result['status']).toBe('uploaded');

    const options = binary.mock.calls[0][3]!;
    expect(options.headers?.['Content-Type']).toBe('application/octet-stream');
    expect(options.params?.['path']).toBe('/home/user/test.txt');
  });

  it('upload files single tar uses x tar', async () => {
    const path = join(tempDir(), 'payload.tar');
    writeTar(path);

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const binary = vi
      .spyOn(client, '_dataBinary')
      .mockResolvedValue(makeResult({ success: true, statusCode: 200, data: { status: 'uploaded' } }));

    await client.uploadFiles(
      'test-agent',
      'session-123',
      [{ localFile: path }],
      { path: '/tmp/' },
    );

    const options = binary.mock.calls[0][3]!;
    // tar must go on the dedicated application/x-tar channel; sending it as
    // application/octet-stream makes the gateway reset the connection and the
    // real server error is masked by an SSL EOF.
    expect(options.headers?.['Content-Type']).toBe('application/x-tar');
  });

  it('upload files tar by magic bytes without extension', async () => {
    // A real tar whose filename lacks the .tar suffix must still be detected
    // via the ustar magic at offset 257.
    const path = join(tempDir(), 'payload');
    writeTar(path);

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const binary = vi
      .spyOn(client, '_dataBinary')
      .mockResolvedValue(makeResult({ success: true, statusCode: 200, data: { status: 'uploaded' } }));

    await client.uploadFiles(
      'test-agent',
      'session-123',
      [{ localFile: path }],
      { path: '/tmp/' },
    );

    const options = binary.mock.calls[0][3]!;
    expect(options.headers?.['Content-Type']).toBe('application/x-tar');
  });

  it('upload files multiple files multipart', async () => {
    const dir = tempDir();
    const path1 = join(dir, 'one.txt');
    const path2 = join(dir, 'two.txt');
    writeFileSync(path1, 'content1');
    writeFileSync(path2, 'content2');

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({
        success: true,
        statusCode: 200,
        data: { status: 'uploaded', files: 2 },
      }),
    );

    const result = await client.uploadFiles(
      'test-agent',
      'session-123',
      [{ localFile: path1 }, { localFile: path2 }],
      { path: '/tmp/' },
    );

    expect(result['files']).toBe(2);

    const options = data.mock.calls[0][2]!;
    expect(options).toHaveProperty('files');
    expect(options.params?.['path']).toBe('/tmp/');
  });

  it('upload files empty files raises error', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });

    await expect(client.uploadFiles('test-agent', 'session-123', [])).rejects.toThrow(
      /Files list cannot be empty/,
    );
  });

  it('upload files with metadata', async () => {
    const path = tempFile('test.txt', 'test');

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const binary = vi
      .spyOn(client, '_dataBinary')
      .mockResolvedValue(makeResult({ success: true, statusCode: 200, data: { status: 'uploaded' } }));

    await client.uploadFiles(
      'test-agent',
      'session-123',
      [{ path: '/home/user/test.txt', localFile: path }],
      { fileUserId: 1001, fileGroupId: 1001, fileMode: '0755' },
    );

    const options = binary.mock.calls[0][3]!;
    expect(options.params?.['user_id']).toBe(1001);
    expect(options.params?.['group_id']).toBe(1001);
    expect(options.params?.['file_mode']).toBe('0755');
  });

  it('upload files with bearer token', async () => {
    const path = tempFile('test.txt', 'test');

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const binary = vi
      .spyOn(client, '_dataBinary')
      .mockResolvedValue(makeResult({ success: true, statusCode: 200, data: { status: 'uploaded' } }));

    await client.uploadFiles(
      'test-agent',
      'session-123',
      [{ path: '/home/user/test.txt', localFile: path }],
      { bearerToken: 'test-token' },
    );

    const options = binary.mock.calls[0][3]!;
    expect(options.headers?.['Authorization']).toBe('Bearer test-token');
  });

  it('upload files failure raises error', async () => {
    const path = tempFile('test.txt', 'test');

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    vi.spyOn(client, '_dataBinary').mockResolvedValue(
      makeResult({ success: false, statusCode: 500, error: 'Upload failed' }),
    );

    await expect(
      client.uploadFiles('test-agent', 'session-123', [
        { path: '/home/user/test.txt', localFile: path },
      ]),
    ).rejects.toThrow(/upload_files failed/);
  });

  it('upload files oversized file raises error', () => {
    const path = join(tempDir(), 'huge.bin');
    writeFileSync(path, '');
    truncateSync(path, MAX_FILE_SIZE + 1);

    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });

    return expect(
      client.uploadFiles('test-agent', 'session-123', [
        { path: '/home/user/test.txt', localFile: path },
      ]),
    ).rejects.toThrow(/File too large/);
  });

  it('upload files oversized content raises error', () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });

    return expect(
      client.uploadFiles('test-agent', 'session-123', [
        { content: Buffer.alloc(MAX_FILE_SIZE + 1, 'x') },
      ]),
    ).rejects.toThrow(/Content too large/);
  });
});

// ============================================================
// download_files
// ============================================================

describe('TestRuntimeClientDownloadFiles', () => {
  it('download files returns stream result', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    stubFetch(streamResponse([Buffer.from('test content')], 'application/octet-stream'));

    const result = await client.downloadFiles('test-agent', 'session-123', '/home/user/test.txt');

    expect(result).toBeInstanceOf(StreamDownloadResult);
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain('octet-stream');
  });

  it('download files signs when ak sk enabled', async () => {
    // Regression: the streaming download path must sign (V11) when the data
    // client has AK/SK enabled. Previously `download_files` bypassed signing ->
    // unsigned request -> HTTP 401 on IAM agents (while upload_files, which
    // goes through the signed pipeline, worked).
    const client = new RuntimeClient({
      dataEndpoint: 'https://test.example.com',
      signMode: SignMode.V11_HMAC_SHA256,
      regionId: 'cn-southwest-2',
    });
    const dataClient: any = (client as any)._dataClient;
    dataClient._credentials = { ak: 'ak', sk: 'sk', securityToken: null };
    expect(dataClient._openAkSk).toBe(true);

    const sign = vi.spyOn(dataClient, '_signRequest').mockResolvedValue({ headers: {} });
    stubFetch(streamResponse([Buffer.from('test content')], 'application/octet-stream'));

    await client.downloadFiles('test-agent', 'session-123', '/x');

    expect(sign).toHaveBeenCalledOnce();
  });

  it('download files recursive tar', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    stubFetch(streamResponse([Buffer.from('tar content')], 'application/x-tar'));

    const result = await client.downloadFiles('test-agent', 'session-123', '/home/user/data', {
      recursive: true,
    });

    expect(result).toBeInstanceOf(StreamDownloadResult);
    expect(result.contentType).toContain('x-tar');
  });

  it('download files iter bytes', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    stubFetch(
      streamResponse(
        [Buffer.from('chunk1'), Buffer.from('chunk2')],
        'application/octet-stream',
      ),
    );

    const result = await client.downloadFiles('test-agent', 'session-123', '/home/user/test.txt');

    const chunks: string[] = [];
    for await (const chunk of result.iterBytes()) {
      chunks.push(Buffer.from(chunk).toString('utf8'));
    }
    expect(chunks).toEqual(['chunk1', 'chunk2']);
  });

  it('download files close', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    stubFetch(streamResponse([], 'application/octet-stream'));
    const closeSpy = vi.spyOn(RequestResult.prototype, 'close');

    const result = await client.downloadFiles('test-agent', 'session-123', '/home/user/test.txt');

    result.close();
    expect(closeSpy).toHaveBeenCalledOnce();
    expect(result._rawResponse).toBeNull();
  });

  it('stream download result no response raises', async () => {
    const result = new StreamDownloadResult({
      success: true,
      statusCode: 200,
      contentType: 'application/octet-stream',
    });

    await expect(result.iterBytes().next()).rejects.toThrow(/No response available/);
  });
});

// ============================================================
// stop_session
// ============================================================

describe('TestRuntimeClientStopSession', () => {
  it('stop session success', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi
      .spyOn(client, '_data')
      .mockResolvedValue(
        makeResult({ success: true, statusCode: 200, data: { status: 'stopped' } }),
      );

    const result = await client.stopSession('test-agent', 'session-123');

    expect(result['status']).toBe('stopped');

    expect(data.mock.calls[0][0]).toBe('POST');
    expect(data.mock.calls[0][1]).toBe('/runtimes/test-agent/sessions-stop');
  });

  it('stop session with bearer token', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    const data = vi
      .spyOn(client, '_data')
      .mockResolvedValue(
        makeResult({ success: true, statusCode: 200, data: { status: 'stopped' } }),
      );

    await client.stopSession('test-agent', 'session-123', { bearerToken: 'test-token' });

    const options = data.mock.calls[0][2]!;
    expect(options.headers?.['Authorization']).toBe('Bearer test-token');
  });

  it('stop session failure raises error', async () => {
    const client = new RuntimeClient({ dataEndpoint: 'https://test.example.com' });
    vi.spyOn(client, '_data').mockResolvedValue(
      makeResult({ success: false, statusCode: 404, error: 'Session not found' }),
    );

    await expect(client.stopSession('test-agent', 'session-123')).rejects.toThrow(
      /stop_session failed/,
    );
  });
});

// ============================================================
// StreamDownloadResult
// ============================================================

describe('TestStreamDownloadResult', () => {
  it('stream download result init', () => {
    const result = new StreamDownloadResult({
      success: true,
      statusCode: 200,
      contentType: 'application/octet-stream',
    });

    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toBe('application/octet-stream');
    expect(result.error).toBeNull();
  });

  it('stream download result with error', () => {
    const result = new StreamDownloadResult({
      success: false,
      statusCode: 500,
      contentType: 'application/json',
      error: 'Download failed',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Download failed');
  });

  it('stream download result close with none response', () => {
    const result = new StreamDownloadResult({
      success: true,
      statusCode: 200,
      contentType: 'application/octet-stream',
    });

    result.close();
    expect(result._rawResponse).toBeNull();
  });
});

describe('Runtime query serialization regression', () => {
  it('sends each pagination parameter exactly once through the real request pipeline', async () => {
    const client = new RuntimeClient({controlEndpoint:'https://runtime.example.com', dataEndpoint:'https://runtime.example.com'});
    const fetchMock = stubFetch(new Response(JSON.stringify({items:[]}), {headers:{'content-type':'application/json'}}));
    vi.spyOn((client as any)._controlClient, '_signRequest').mockImplementation(async (_method, _url, options) => options);
    await client.getAgents({limit:10,offset:1});
    const url = new URL(String((fetchMock.mock.calls as any[][])[0][0]));
    expect(url.searchParams.getAll('limit')).toEqual(['10']);
    expect(url.searchParams.getAll('offset')).toEqual(['1']);
  });
});

// ============================================================
// Query parameter serialization
// ============================================================

/** Give the signer credentials so the real request pipeline can run. */
function stubCredentials(): void {
  vi.stubEnv('HUAWEICLOUD_SDK_AK', 'fake-ak');
  vi.stubEnv('HUAWEICLOUD_SDK_SK', 'fake-sk');
  vi.stubEnv('HUAWEICLOUD_SDK_PROJECT_ID', 'fake-project');
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TestRuntimeClientQuerySerialization', () => {
  it('find agent by name sends each parameter exactly once', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({ items: [] }));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client.findAgentByName('runtime-caigeng1123');

    const url = String(mock.mock.calls[0][0]);
    expect(url).toBe(
      'https://control.example.com/v1/core/runtimes?name=runtime-caigeng1123&match_type=EXACT',
    );
    // The gateway recomputes the canonical query from the wire URL, so a
    // duplicated key would invalidate the signature.
    const params = new URL(url).searchParams;
    expect(params.getAll('name')).toEqual(['runtime-caigeng1123']);
    expect(params.getAll('match_type')).toEqual(['EXACT']);
  });

  it('encodes query values as RFC 3986, matching the canonical request', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({ items: [] }));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client.findAgentByName('agent one(x)');

    const url = String(mock.mock.calls[0][0]);
    // Space must be `%20` (not `+`) and `()` must be escaped.
    expect(url).toContain('name=agent%20one%28x%29');
    expect(url).not.toContain('+');
  });

  it('get agents sends pagination and extra filters exactly once', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({ items: [] }));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client.getAgents({
      agentName: 'agent one',
      offset: 2,
      limit: 20,
      extra: { tag: 'prod' },
    });

    const raw = String(mock.mock.calls[0][0]);
    const params = new URL(raw).searchParams;
    expect(params.get('agent_name')).toBe('agent one');
    expect(params.get('offset')).toBe('2');
    expect(params.get('limit')).toBe('20');
    expect(params.get('tag')).toBe('prod');
    // Count raw occurrences: `getAll` alone would hide a duplicated pair.
    for (const key of ['agent_name', 'offset', 'limit', 'tag']) {
      expect(raw.split(`${key}=`).length - 1).toBe(1);
    }
  });

  it('keeps every array value, once each', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({ items: [] }));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client.getAgents({ extra: { tag: ['prod', 'dev'] } });

    const raw = String(mock.mock.calls[0][0]);
    // The signer sorts multi-valued params in place for the canonical request,
    // so the wire order follows that sorted order instead of the caller's.
    expect(raw.split('tag=').length - 1).toBe(2);
    expect(new URL(raw).searchParams.getAll('tag').sort()).toEqual(['dev', 'prod']);
  });

  it('appends to an existing query string with a single ?', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({}));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client._control('GET', '/v1/core/runtimes?foo=1', { params: { bar: '2' } });

    const raw = String(mock.mock.calls[0][0]);
    expect(raw).toBe('https://control.example.com/v1/core/runtimes?foo=1&bar=2');
    expect(raw.split('?').length - 1).toBe(1);
  });

  it('omits null and undefined parameters', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({}));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client._control('GET', '/v1/core/runtimes', {
      params: { keep: 'v', missing: undefined, empty: null },
    });

    const raw = String(mock.mock.calls[0][0]);
    expect(raw).toBe('https://control.example.com/v1/core/runtimes?keep=v');
  });

  it('issues a single signed fetch for a query request', async () => {
    stubCredentials();
    const mock = stubFetch(jsonResponse({ items: [] }));
    const client = new RuntimeClient({ controlEndpoint: 'https://control.example.com' });

    await client.findAgentByName('runtime-caigeng1123');

    expect(mock).toHaveBeenCalledTimes(1);
    const raw = String(mock.mock.calls[0][0]);
    expect(raw.split('name=').length - 1).toBe(1);
    expect(raw.split('match_type=').length - 1).toBe(1);

    const { headers } = mock.mock.calls[0][1] as { headers: Record<string, string> };
    const authHeader = Object.keys(headers).find((key) => key.toLowerCase() === 'authorization');
    expect(authHeader).toBeDefined();
    expect(headers[authHeader!]).toMatch(/^SDK-HMAC-SHA256 /);
  });
});

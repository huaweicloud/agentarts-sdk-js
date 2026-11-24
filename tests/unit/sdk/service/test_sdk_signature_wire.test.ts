import { afterAll, beforeAll, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';
import { SDKSigner } from 'agentarts-sdk/sdk/utils/signer';
import {
  BaseHTTPClient,
  RequestConfig,
  type RequestOptions,
} from 'agentarts-sdk/sdk/service/http-client';

// Receive actual fetch bytes; neither serialization nor the signer is mocked.
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks);
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      method: req.method,
      body: body.toString('utf8'),
      digest: createHash('sha256').update(body).digest('hex'),
      headers: req.headers,
    }),
  );
});
let endpoint: string;
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

class TestClient extends BaseHTTPClient {
  constructor(token?: string) {
    super(new RequestConfig({ baseUrl: endpoint }), true);
    this._credentials = new BasicCredentials().withAk('test-ak').withSk('test-only-secret');
    if (token) this._credentials.withSecurityToken(token);
  }
}

const cases: Array<{ name: string; method: string; options: RequestOptions; body: string }> = [
  {
    name: 'JSON with escapes and Unicode',
    method: 'POST',
    options: { json: { text: '中文🙂\n"quoted"\\path', enabled: false, count: 0 } },
    body: '{"text":"中文🙂\\n\\"quoted\\"\\\\path","enabled":false,"count":0}',
  },
  {
    name: 'raw text with CRLF',
    method: 'PUT',
    options: { data: 'first\r\nsecond🙂' },
    body: 'first\r\nsecond🙂',
  },
  {
    name: 'URL encoded form',
    method: 'POST',
    options: { data: { q: 'a b&c', n: '0' } },
    body: 'q=a+b%26c&n=0',
  },
  { name: 'empty string', method: 'POST', options: { data: '' }, body: '' },
  { name: 'GET without body', method: 'GET', options: {}, body: '' },
  { name: 'DELETE with null body', method: 'DELETE', options: { data: null }, body: '' },
];

for (const { name, method, options, body } of cases) {
  test(`HTTP signature digest matches received bytes: ${name}`, async () => {
    const result = await new TestClient().request(method, '/echo', options);
    expect(result.success).toBe(true);
    expect(result.data.method).toBe(method);
    expect(result.data.body).toBe(body);
    expect(result.data.headers['x-sdk-content-sha256']).toBe(result.data.digest);
    expect(result.data.headers.authorization).toMatch(/^SDK-HMAC-SHA256 /);
    expect(result.data.headers['x-security-token']).toBeUndefined();
  });
}

test('temporary credential token reaches the HTTP service alongside the body digest', async () => {
  const result = await new TestClient('test-session-token').post('/echo', {
    json: { name: 'temporary' },
  });
  expect(result.success).toBe(true);
  expect(result.data.headers['x-security-token']).toBe('test-session-token');
  expect(result.data.headers['x-sdk-content-sha256']).toBe(result.data.digest);
});

for (const header of ['X-Sdk-Content-Sha256', 'x-sdk-content-sha256', 'X-SDK-CONTENT-SHA256']) {
  test(`preserves an explicit digest without duplicate header names: ${header}`, async () => {
    const digest = 'a'.repeat(64);
    const credentials = new BasicCredentials().withAk('test-ak').withSk('test-only-secret');
    const headers = await new SDKSigner(credentials).sign(
      'POST',
      'https://example.com/upload',
      { [header]: digest },
      'payload with caller-managed digest',
    );
    expect(headers['X-Sdk-Content-Sha256']).toBe(digest);
    expect(
      Object.keys(headers).filter((key) => key.toLowerCase() === 'x-sdk-content-sha256'),
    ).toEqual(['X-Sdk-Content-Sha256']);
  });
}

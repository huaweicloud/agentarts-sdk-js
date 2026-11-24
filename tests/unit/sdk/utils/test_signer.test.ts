import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SDKSigner } from 'agentarts-sdk/sdk/utils/signer';
import { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';
import { AKSKSigner } from '@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner.js';
const creds = new BasicCredentials().withAk('test-ak').withSk('test-secret-not-real');
for (const [name, body] of [
  ['json', JSON.stringify({ name: '中文', enabled: false, count: 0 })],
  ['text', 'a=1&b=hello'],
  ['empty', ''],
  ['get', null],
]) {
  test(`signature matches wire bytes: ${name}`, async () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Sdk-Date': '20261124T000000Z',
    };
    const url = 'https://example.com/v1/core/gateways';
    const expectedHash = createHash('sha256')
      .update(body ?? '')
      .digest('hex');
    const expected = AKSKSigner.sign(
      {
        method: 'POST',
        endpoint: url,
        headers: { ...headers, 'X-Sdk-Content-Sha256': expectedHash },
        data: body ?? undefined,
        queryParams: {},
      },
      creds,
    ) as Record<string, string>;
    const actual = await new SDKSigner(creds).sign('POST', url, headers, body);
    assert.equal(actual['X-Sdk-Content-Sha256'], expectedHash);
    assert.match(actual.Authorization, /^SDK-HMAC-SHA256 /);
    assert.equal(actual.Authorization, expected.Authorization);
  });
}
test('explicit unsigned payload preserved and normalized', async () => {
  const headers = await new SDKSigner(creds).sign(
    'POST',
    'https://example.com/upload',
    { 'x-sdk-content-sha256': 'UNSIGNED-PAYLOAD' },
    'binary',
  );
  assert.equal(headers['X-Sdk-Content-Sha256'], 'UNSIGNED-PAYLOAD');
  assert(!Object.hasOwn(headers, 'x-sdk-content-sha256'));
});

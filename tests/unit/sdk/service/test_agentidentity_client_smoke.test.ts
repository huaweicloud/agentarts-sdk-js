/**
 * Smoke tests for the ported AgentIdentity v1 client.
 *
 * Mirrors the Python usage in
 * `agentarts-sdk-python/src/agentarts/sdk/service/identity/identity_client.py`:
 * request/URL construction (method, path, query params, wire body) and response
 * model deserialization. `HcClient.sendRequest` is stubbed, so no network access.
 */
import { describe, expect, it, vi } from 'vitest';
import { DefaultHttpClient } from '@huaweicloud/huaweicloud-sdk-core/http/DefaultHttpClient.js';
import { HcClient } from '@huaweicloud/huaweicloud-sdk-core/HcClient.js';
import type { HttpRequestOptions } from '@huaweicloud/huaweicloud-sdk-core/HcClient.js';
import {
  AgentIdentityClient,
  AuthorizerType,
  CreateWorkloadAccessTokenRequest,
  CreateWorkloadAccessTokenRequestBody,
  CreateWorkloadIdentityReqBody,
  CreateWorkloadIdentityRequest,
  CreateWorkloadIdentityResponse,
  GetResourceApiKeyRequest,
  GetResourceApiKeyRequestBody,
  GetWorkloadIdentityRequest,
  ListWorkloadIdentitiesRequest,
  PageInfo,
  WorkloadIdentity,
  WorkloadIdentitySummary,
} from 'huaweicloud-sdk-agentidentity';

const ENDPOINT = 'https://agentidentity.example.com';

function createClient(): { hcClient: HcClient; client: AgentIdentityClient } {
  const hcClient = new HcClient(new DefaultHttpClient({}, [ENDPOINT]));
  return { hcClient, client: new AgentIdentityClient(hcClient) };
}

/** Options of the n-th request captured by the stubbed `sendRequest`. */
function sentOptions(spy: { mock: { calls: any[][] } }, callIndex = 0): HttpRequestOptions {
  return spy.mock.calls[callIndex]![0] as HttpRequestOptions;
}

describe('AgentIdentityClient', () => {
  it('createWorkloadIdentity sends the expected request and deserializes the response', async () => {
    const { hcClient, client } = createClient();
    const sendRequest = vi.spyOn(hcClient, 'sendRequest').mockResolvedValue({
      workload_identity: {
        name: 'wl-smoke',
        urn: 'urn:huawei:agentidentity::123:workload-identity/wl-smoke',
        allowed_resource_oauth2_return_urls: ['https://localhost:8080/callback'],
        authorizer_type: 'NONE',
        created_at: '2026-01-02T03:04:05Z',
        updated_at: '2026-01-02T03:04:06Z',
      },
      httpStatusCode: 201,
    } as any);

    const response = await client.createWorkloadIdentity(
      new CreateWorkloadIdentityRequest({
        body: new CreateWorkloadIdentityReqBody({
          name: 'wl-smoke',
          allowedResourceOauth2ReturnUrls: ['https://localhost:8080/callback'],
          authorizerType: AuthorizerType.NONE,
        }),
      }),
    );

    expect(sendRequest).toHaveBeenCalledTimes(1);
    const options = sentOptions(sendRequest);
    expect(options.method).toBe('POST');
    expect(options.url).toBe('/v1/workload-identities');
    expect(options.contentType).toBe('application/json');
    expect(options.queryParams).toEqual({});
    expect(options.pathParams).toEqual({});
    // The request body is serialized to the snake_case wire format.
    expect(options.data).toEqual({
      name: 'wl-smoke',
      allowed_resource_oauth2_return_urls: ['https://localhost:8080/callback'],
      authorizer_type: 'NONE',
    });

    expect(response).toBeInstanceOf(CreateWorkloadIdentityResponse);
    expect(response.httpStatusCode).toBe(201);
    expect(response.workloadIdentity).toBeInstanceOf(WorkloadIdentity);
    expect(response.workloadIdentity?.name).toBe('wl-smoke');
    expect(response.workloadIdentity?.urn).toBe('urn:huawei:agentidentity::123:workload-identity/wl-smoke');
    expect(response.workloadIdentity?.allowedResourceOauth2ReturnUrls).toEqual([
      'https://localhost:8080/callback',
    ]);
    expect(response.workloadIdentity?.authorizerType).toBe('NONE');
    expect(response.workloadIdentity?.createdAt).toBe('2026-01-02T03:04:05Z');
  });

  it('getWorkloadIdentity interpolates the path parameter', async () => {
    const { hcClient, client } = createClient();
    const sendRequest = vi.spyOn(hcClient, 'sendRequest').mockResolvedValue({
      workload_identity: { name: 'wl-42', authorizer_type: 'IAM' },
      httpStatusCode: 200,
    } as any);

    const response = await client.getWorkloadIdentity(
      new GetWorkloadIdentityRequest({ workloadIdentityName: 'wl-42' }),
    );

    const options = sentOptions(sendRequest);
    expect(options.method).toBe('GET');
    expect(options.url).toBe('/v1/workload-identities/wl-42');
    expect(options.pathParams).toEqual({ workload_identity_name: 'wl-42' });
    expect(options.queryParams).toEqual({});
    expect(options.data).toBeUndefined();
    expect(response.httpStatusCode).toBe(200);
    expect(response.workloadIdentity?.name).toBe('wl-42');
  });

  it('listWorkloadIdentities forwards pagination and deserializes the list', async () => {
    const { hcClient, client } = createClient();
    const sendRequest = vi.spyOn(hcClient, 'sendRequest').mockResolvedValue({
      workload_identities: [
        { name: 'wl-1', authorizer_type: 'NONE' },
        { name: 'wl-2', authorizer_type: 'CUSTOM_JWT' },
      ],
      page_info: { next_marker: 'next', current_count: 2 },
      httpStatusCode: 200,
    } as any);

    const response = await client.listWorkloadIdentities(
      new ListWorkloadIdentitiesRequest({ limit: 2, marker: 'start' }),
    );

    const options = sentOptions(sendRequest);
    expect(options.method).toBe('GET');
    expect(options.url).toBe('/v1/workload-identities');
    expect(options.queryParams).toEqual({ limit: 2, marker: 'start' });
    expect(response.workloadIdentities).toHaveLength(2);
    expect(response.workloadIdentities?.[0]).toBeInstanceOf(WorkloadIdentitySummary);
    expect(response.workloadIdentities?.[1]?.name).toBe('wl-2');
    expect(response.pageInfo).toBeInstanceOf(PageInfo);
    expect(response.pageInfo?.nextMarker).toBe('next');
    expect(response.pageInfo?.currentCount).toBe(2);
  });

  it('invoker retries until the retry condition is satisfied', async () => {
    // EQUAL_JITTER delay would be `random() * 1000` ms; force zero to keep the test fast.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { hcClient, client } = createClient();
    const sendRequest = vi
      .spyOn(hcClient, 'sendRequest')
      .mockRejectedValueOnce(Object.assign(new Error('throttled'), { statusCode: 429 }))
      .mockResolvedValue({ workload_access_token: 'token-1', httpStatusCode: 200 } as any);

    const response = await client
      .createWorkloadAccessTokenInvoker(
        new CreateWorkloadAccessTokenRequest({
          body: new CreateWorkloadAccessTokenRequestBody({ workloadName: 'wl-smoke' }),
        }),
      )
      .withRetry({
        retryCondition: (_resp, err) => err !== undefined,
        maxRetries: 3,
        backoffStrategy: 'EQUAL_JITTER',
      })
      .invoke();

    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(response.workloadAccessToken).toBe('token-1');
    expect(response.httpStatusCode).toBe(200);
  });

  it('invoker stops after maxRetries and rethrows the last error', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { hcClient, client } = createClient();
    const sendRequest = vi
      .spyOn(hcClient, 'sendRequest')
      .mockRejectedValue(Object.assign(new Error('server error'), { statusCode: 500 }));

    const invoker = client
      .getResourceApiKeyInvoker(
        new GetResourceApiKeyRequest({
          body: new GetResourceApiKeyRequestBody({
            resourceCredentialProviderName: 'provider-1',
            workloadAccessToken: 'token-1',
          }),
        }),
      )
      .withRetry({ retryCondition: () => true, maxRetries: 1, backoffStrategy: 'EXPONENTIAL' });

    await expect(invoker.invoke()).rejects.toThrow('server error');
    // 1 initial call + 1 retry.
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  it('invoker without withRetry performs a single call', async () => {
    const { hcClient, client } = createClient();
    const sendRequest = vi.spyOn(hcClient, 'sendRequest').mockResolvedValue({
      workload_identity: { name: 'wl-1' },
      httpStatusCode: 200,
    } as any);

    await client
      .getWorkloadIdentityInvoker(new GetWorkloadIdentityRequest({ workloadIdentityName: 'wl-1' }))
      .invoke();

    expect(sendRequest).toHaveBeenCalledTimes(1);
  });
});

describe('Identity query signing regression', () => {
  it.each(['listWorkloadIdentities','listApiKeyCredentialProviders','listOauth2CredentialProviders','listStsCredentialProviders'] as const)(
    '%s omits unset query parameters before Core signing and serialization', async (method) => {
      const {hcClient,client}=createClient();
      const send=vi.spyOn(hcClient,'sendRequest').mockResolvedValue({});
      await (client[method] as any)({limit:1});
      expect(sentOptions(send).queryParams).toEqual({limit:1});
      await (client[method] as any)({limit:1,marker:'next'});
      expect(sentOptions(send,1).queryParams).toEqual({limit:1,marker:'next'});
    });
});

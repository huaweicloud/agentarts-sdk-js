/* eslint-disable */
// Ported from huaweicloudsdkagentidentity/v1/agentidentity_client.py.
import { ClientBuilder } from '@huaweicloud/huaweicloud-sdk-core/ClientBuilder.js';
import { HcClient } from '@huaweicloud/huaweicloud-sdk-core/HcClient.js';
import type { HttpRequestOptions } from '@huaweicloud/huaweicloud-sdk-core/HcClient.js';
import { Invoker } from './Invoker.js';
import { CompleteResourceTokenAuthRequest } from './model/complete-resource-token-auth-request.js';
import { CreateApiKeyCredentialProviderRequest } from './model/create-api-key-credential-provider-request.js';
import { CreateOauth2CredentialProviderRequest } from './model/create-oauth2-credential-provider-request.js';
import { CreatePolicyEngineRequest } from './model/create-policy-engine-request.js';
import { CreatePolicyRequest } from './model/create-policy-request.js';
import { CreateStsCredentialProviderRequest } from './model/create-sts-credential-provider-request.js';
import { CreateWorkloadAccessTokenForJwtRequest } from './model/create-workload-access-token-for-jwt-request.js';
import { CreateWorkloadAccessTokenForUserIdRequest } from './model/create-workload-access-token-for-user-id-request.js';
import { CreateWorkloadAccessTokenRequest } from './model/create-workload-access-token-request.js';
import { CreateWorkloadIdentityRequest } from './model/create-workload-identity-request.js';
import { DeleteApiKeyCredentialProviderRequest } from './model/delete-api-key-credential-provider-request.js';
import { DeleteOauth2CredentialProviderRequest } from './model/delete-oauth2-credential-provider-request.js';
import { DeletePolicyEngineRequest } from './model/delete-policy-engine-request.js';
import { DeletePolicyRequest } from './model/delete-policy-request.js';
import { DeleteStsCredentialProviderRequest } from './model/delete-sts-credential-provider-request.js';
import { DeleteWorkloadIdentityRequest } from './model/delete-workload-identity-request.js';
import { GetApiKeyCredentialProviderRequest } from './model/get-api-key-credential-provider-request.js';
import { GetOauth2CredentialProviderRequest } from './model/get-oauth2-credential-provider-request.js';
import { GetPolicyEngineRequest } from './model/get-policy-engine-request.js';
import { GetPolicyRequest } from './model/get-policy-request.js';
import { GetResourceApiKeyRequest } from './model/get-resource-api-key-request.js';
import { GetResourceOauth2TokenRequest } from './model/get-resource-oauth2-token-request.js';
import { GetResourceStsTokenRequest } from './model/get-resource-sts-token-request.js';
import { GetStsCredentialProviderRequest } from './model/get-sts-credential-provider-request.js';
import { GetTokenVaultRequest } from './model/get-token-vault-request.js';
import { GetWorkloadIdentityAuthorizerConfigurationRequest } from './model/get-workload-identity-authorizer-configuration-request.js';
import { GetWorkloadIdentityRequest } from './model/get-workload-identity-request.js';
import { ListApiKeyCredentialProvidersRequest } from './model/list-api-key-credential-providers-request.js';
import { ListIdentityProvidersRequest } from './model/list-identity-providers-request.js';
import { ListOauth2CredentialProvidersRequest } from './model/list-oauth2-credential-providers-request.js';
import { ListPoliciesRequest } from './model/list-policies-request.js';
import { ListPolicyEngineAttachmentsRequest } from './model/list-policy-engine-attachments-request.js';
import { ListPolicyEnginesRequest } from './model/list-policy-engines-request.js';
import { ListStsCredentialProvidersRequest } from './model/list-sts-credential-providers-request.js';
import { ListWorkloadIdentitiesRequest } from './model/list-workload-identities-request.js';
import { Oauth2AuthorizeRequest } from './model/oauth2-authorize-request.js';
import { Oauth2CallbackRequest } from './model/oauth2-callback-request.js';
import { UpdateApiKeyCredentialProviderRequest } from './model/update-api-key-credential-provider-request.js';
import { UpdateOauth2CredentialProviderRequest } from './model/update-oauth2-credential-provider-request.js';
import { UpdatePolicyEngineRequest } from './model/update-policy-engine-request.js';
import { UpdatePolicyRequest } from './model/update-policy-request.js';
import { UpdateStsCredentialProviderRequest } from './model/update-sts-credential-provider-request.js';
import { UpdateTokenVaultRequest } from './model/update-token-vault-request.js';
import { UpdateWorkloadIdentityRequest } from './model/update-workload-identity-request.js';
import { CompleteResourceTokenAuthResponse } from './model/complete-resource-token-auth-response.js';
import { CreateApiKeyCredentialProviderResponse } from './model/create-api-key-credential-provider-response.js';
import { CreateOauth2CredentialProviderResponse } from './model/create-oauth2-credential-provider-response.js';
import { CreatePolicyEngineResponse } from './model/create-policy-engine-response.js';
import { CreatePolicyResponse } from './model/create-policy-response.js';
import { CreateStsCredentialProviderResponse } from './model/create-sts-credential-provider-response.js';
import { CreateWorkloadAccessTokenForJwtResponse } from './model/create-workload-access-token-for-jwt-response.js';
import { CreateWorkloadAccessTokenForUserIdResponse } from './model/create-workload-access-token-for-user-id-response.js';
import { CreateWorkloadAccessTokenResponse } from './model/create-workload-access-token-response.js';
import { CreateWorkloadIdentityResponse } from './model/create-workload-identity-response.js';
import { DeleteApiKeyCredentialProviderResponse } from './model/delete-api-key-credential-provider-response.js';
import { DeleteOauth2CredentialProviderResponse } from './model/delete-oauth2-credential-provider-response.js';
import { DeletePolicyEngineResponse } from './model/delete-policy-engine-response.js';
import { DeletePolicyResponse } from './model/delete-policy-response.js';
import { DeleteStsCredentialProviderResponse } from './model/delete-sts-credential-provider-response.js';
import { DeleteWorkloadIdentityResponse } from './model/delete-workload-identity-response.js';
import { GetApiKeyCredentialProviderResponse } from './model/get-api-key-credential-provider-response.js';
import { GetOauth2CredentialProviderResponse } from './model/get-oauth2-credential-provider-response.js';
import { GetPolicyEngineResponse } from './model/get-policy-engine-response.js';
import { GetPolicyResponse } from './model/get-policy-response.js';
import { GetResourceApiKeyResponse } from './model/get-resource-api-key-response.js';
import { GetResourceOauth2TokenResponse } from './model/get-resource-oauth2-token-response.js';
import { GetResourceStsTokenResponse } from './model/get-resource-sts-token-response.js';
import { GetStsCredentialProviderResponse } from './model/get-sts-credential-provider-response.js';
import { GetTokenVaultResponse } from './model/get-token-vault-response.js';
import { GetWorkloadIdentityAuthorizerConfigurationResponse } from './model/get-workload-identity-authorizer-configuration-response.js';
import { GetWorkloadIdentityResponse } from './model/get-workload-identity-response.js';
import { ListApiKeyCredentialProvidersResponse } from './model/list-api-key-credential-providers-response.js';
import { ListIdentityProvidersResponse } from './model/list-identity-providers-response.js';
import { ListOauth2CredentialProvidersResponse } from './model/list-oauth2-credential-providers-response.js';
import { ListPoliciesResponse } from './model/list-policies-response.js';
import { ListPolicyEngineAttachmentsResponse } from './model/list-policy-engine-attachments-response.js';
import { ListPolicyEnginesResponse } from './model/list-policy-engines-response.js';
import { ListStsCredentialProvidersResponse } from './model/list-sts-credential-providers-response.js';
import { ListWorkloadIdentitiesResponse } from './model/list-workload-identities-response.js';
import { Oauth2AuthorizeResponse } from './model/oauth2-authorize-response.js';
import { Oauth2CallbackResponse } from './model/oauth2-callback-response.js';
import { UpdateApiKeyCredentialProviderResponse } from './model/update-api-key-credential-provider-response.js';
import { UpdateOauth2CredentialProviderResponse } from './model/update-oauth2-credential-provider-response.js';
import { UpdatePolicyEngineResponse } from './model/update-policy-engine-response.js';
import { UpdatePolicyResponse } from './model/update-policy-response.js';
import { UpdateStsCredentialProviderResponse } from './model/update-sts-credential-provider-response.js';
import { UpdateTokenVaultResponse } from './model/update-token-vault-response.js';
import { UpdateWorkloadIdentityResponse } from './model/update-workload-identity-response.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';


/** The signer must see exactly the query parameters serialized by the transport.
 * Core signs undefined as "undefined", while its querystring serializer emits "".
 */
function compactQuery(query: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined && value !== null));
}

/**
 * AgentIdentity client (v1).
 *
 * Ported from the Huawei Cloud Python SDK `huaweicloudsdkagentidentity.v1.AgentIdentityClient`.
 */
export class AgentIdentityClient {
  private readonly hcClient: HcClient;

  public static newBuilder(): ClientBuilder<AgentIdentityClient> {
    return new ClientBuilder<AgentIdentityClient>((hcClient: HcClient) => new AgentIdentityClient(hcClient));
  }

  constructor(hcClient: HcClient) {
    this.hcClient = hcClient;
  }

  /** Directory of this client, used by {@link ClientBuilder} to load custom credentials. */
  public getPath(): string {
    return dirname(fileURLToPath(import.meta.url));
  }


  /**
   * 创建API密钥凭证提供者
   *
   * Creates a new API key credential provider.
   */
  public async createApiKeyCredentialProvider(request: CreateApiKeyCredentialProviderRequest): Promise<CreateApiKeyCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/api-key-credential-providers',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateApiKeyCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除API密钥凭证提供者
   *
   * Deletes an API key credential provider.
   */
  public async deleteApiKeyCredentialProvider(request: DeleteApiKeyCredentialProviderRequest): Promise<DeleteApiKeyCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/api-key-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeleteApiKeyCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询API密钥凭证提供者详情
   *
   * Gets details of an API key credential provider.
   */
  public async getApiKeyCredentialProvider(request: GetApiKeyCredentialProviderRequest): Promise<GetApiKeyCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/api-key-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetApiKeyCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询API密钥凭证提供者列表
   *
   * Lists API key credential providers.
   */
  public async listApiKeyCredentialProviders(request: ListApiKeyCredentialProvidersRequest): Promise<ListApiKeyCredentialProvidersResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/api-key-credential-providers',
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListApiKeyCredentialProvidersResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新API密钥凭证提供者
   *
   * Updates the API key of an existing API key credential provider.
   */
  public async updateApiKeyCredentialProvider(request: UpdateApiKeyCredentialProviderRequest): Promise<UpdateApiKeyCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/api-key-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdateApiKeyCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Confirm user authentication session for OAuth2.0 tokens
   *
   * Confirms the user authentication session to obtain OAuth2.0 tokens for a resource
   */
  public async completeResourceTokenAuth(request: CompleteResourceTokenAuthRequest): Promise<CompleteResourceTokenAuthResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/resource-token-auth/complete',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CompleteResourceTokenAuthResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Retrieve API key from resource credential provider
   *
   * Retrieves the API key associated with a specified resource credential provider
   */
  public async getResourceApiKey(request: GetResourceApiKeyRequest): Promise<GetResourceApiKeyResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/api-key',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetResourceApiKeyResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Retrieve OAuth2.0 token from resource credential provider
   *
   * Returns the OAuth2.0 token for the specified resource using the configured flow
   */
  public async getResourceOauth2Token(request: GetResourceOauth2TokenRequest): Promise<GetResourceOauth2TokenResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/oauth2/token',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetResourceOauth2TokenResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Retrieve STS credentials from STS credential provider
   *
   * Retrieves temporary STS credentials from a specified STS credential provider
   */
  public async getResourceStsToken(request: GetResourceStsTokenRequest): Promise<GetResourceStsTokenResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/sts/token',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetResourceStsTokenResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询身份提供商
   *
   * Lists identity providers.
   */
  public async listIdentityProviders(request: ListIdentityProvidersRequest): Promise<ListIdentityProvidersResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/identity-providers',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListIdentityProvidersResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * OAuth2.0 Pushed Authorization Request (PAR) standard authorize API
   *
   * Core OAuth2 authorization endpoint following RFC 9126 PAR spec, only accepts authorization request via request_uri parameter to trigger user authorization flow
   */
  public async oauth2Authorize(request: Oauth2AuthorizeRequest): Promise<Oauth2AuthorizeResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/oauth2/authorize',
      contentType: 'application/json',
      queryParams: compactQuery({
        request_uri: request.requestUri,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = Oauth2AuthorizeResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * OAuth2.0 Standard Authorization Callback API
   *
   * OAuth2 redirect callback endpoint to receive authorization result after user consent/denial
   */
  public async oauth2Callback(request: Oauth2CallbackRequest): Promise<Oauth2CallbackResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/oauth2/callback/${request.credentialProviderId}`,
      contentType: 'application/json',
      queryParams: compactQuery({
        code: request.code,
        state: request.state,
        error: request.error,
        error_description: request.errorDescription,
      }),
      pathParams: {
        credential_provider_id: request.credentialProviderId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = Oauth2CallbackResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 创建OAuth2凭证提供者
   *
   * Creates a new OAuth2 credential provider.
   */
  public async createOauth2CredentialProvider(request: CreateOauth2CredentialProviderRequest): Promise<CreateOauth2CredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/oauth2-credential-providers',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateOauth2CredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除OAuth2凭证提供者
   *
   * Deletes an OAuth2 credential provider.
   */
  public async deleteOauth2CredentialProvider(request: DeleteOauth2CredentialProviderRequest): Promise<DeleteOauth2CredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/oauth2-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeleteOauth2CredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询OAuth2凭证提供者详情
   *
   * Gets details of an OAuth2 credential provider.
   */
  public async getOauth2CredentialProvider(request: GetOauth2CredentialProviderRequest): Promise<GetOauth2CredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/oauth2-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetOauth2CredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询OAuth2凭证提供者列表
   *
   * Lists OAuth2 credential providers.
   */
  public async listOauth2CredentialProviders(request: ListOauth2CredentialProvidersRequest): Promise<ListOauth2CredentialProvidersResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/oauth2-credential-providers',
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListOauth2CredentialProvidersResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新OAuth2凭证提供者
   *
   * Updates an existing OAuth2 credential provider.
   */
  public async updateOauth2CredentialProvider(request: UpdateOauth2CredentialProviderRequest): Promise<UpdateOauth2CredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/oauth2-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdateOauth2CredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 在指定策略集中创建策略
   *
   * Creates a new policy in the specified policy engine.
   */
  public async createPolicy(request: CreatePolicyRequest): Promise<CreatePolicyResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: `/v1/policy-engines/${request.policyEngineId}/policies`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreatePolicyResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除策略
   *
   * Deletes a policy.
   */
  public async deletePolicy(request: DeletePolicyRequest): Promise<DeletePolicyResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/policy-engines/${request.policyEngineId}/policies/${request.policyId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
        policy_id: request.policyId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeletePolicyResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询策略详情
   *
   * Gets details of a specific policy.
   */
  public async getPolicy(request: GetPolicyRequest): Promise<GetPolicyResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/policy-engines/${request.policyEngineId}/policies/${request.policyId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
        policy_id: request.policyId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetPolicyResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询策略列表
   *
   * Lists policies in the specified policy engine.
   */
  public async listPolicies(request: ListPoliciesRequest): Promise<ListPoliciesResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/policy-engines/${request.policyEngineId}/policies`,
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListPoliciesResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新策略
   *
   * Updates an existing policy.
   */
  public async updatePolicy(request: UpdatePolicyRequest): Promise<UpdatePolicyResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/policy-engines/${request.policyEngineId}/policies/${request.policyId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
        policy_id: request.policyId,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdatePolicyResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 创建策略集
   *
   * Creates a new policy engine.
   */
  public async createPolicyEngine(request: CreatePolicyEngineRequest): Promise<CreatePolicyEngineResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/policy-engines',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreatePolicyEngineResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除策略集
   *
   * Deletes a policy engine.
   */
  public async deletePolicyEngine(request: DeletePolicyEngineRequest): Promise<DeletePolicyEngineResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/policy-engines/${request.policyEngineId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeletePolicyEngineResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询策略集详情
   *
   * Gets details of a policy engine.
   */
  public async getPolicyEngine(request: GetPolicyEngineRequest): Promise<GetPolicyEngineResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/policy-engines/${request.policyEngineId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetPolicyEngineResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询策略集关联的实体列表
   *
   * Lists the entities (gateways and token vaults) attached to the specified policy engine.
   */
  public async listPolicyEngineAttachments(request: ListPolicyEngineAttachmentsRequest): Promise<ListPolicyEngineAttachmentsResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/policy-engines/${request.policyEngineId}/attachments`,
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListPolicyEngineAttachmentsResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询策略集列表
   *
   * Lists policy engines.
   */
  public async listPolicyEngines(request: ListPolicyEnginesRequest): Promise<ListPolicyEnginesResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/policy-engines',
      contentType: 'application/json',
      queryParams: compactQuery({
        type: request.type,
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListPolicyEnginesResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新策略集
   *
   * Updates a policy engine (description only).
   */
  public async updatePolicyEngine(request: UpdatePolicyEngineRequest): Promise<UpdatePolicyEngineResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/policy-engines/${request.policyEngineId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        policy_engine_id: request.policyEngineId,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdatePolicyEngineResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 创建STS凭证提供者
   *
   * Creates a new STS credential provider.
   */
  public async createStsCredentialProvider(request: CreateStsCredentialProviderRequest): Promise<CreateStsCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/sts-credential-providers',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateStsCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除STS凭证提供者
   *
   * Deletes an STS credential provider.
   */
  public async deleteStsCredentialProvider(request: DeleteStsCredentialProviderRequest): Promise<DeleteStsCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/sts-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeleteStsCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询STS凭证提供者详情
   *
   * Gets details of an STS credential provider.
   */
  public async getStsCredentialProvider(request: GetStsCredentialProviderRequest): Promise<GetStsCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/sts-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetStsCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询STS凭证提供者列表
   *
   * Lists STS credential providers.
   */
  public async listStsCredentialProviders(request: ListStsCredentialProvidersRequest): Promise<ListStsCredentialProvidersResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/sts-credential-providers',
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListStsCredentialProvidersResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新STS凭证提供者
   *
   * Updates an existing STS credential provider.
   */
  public async updateStsCredentialProvider(request: UpdateStsCredentialProviderRequest): Promise<UpdateStsCredentialProviderResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/sts-credential-providers/${request.credentialProviderName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        credential_provider_name: request.credentialProviderName,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdateStsCredentialProviderResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询令牌保管库详情
   *
   * Gets details of a token vault.
   */
  public async getTokenVault(request: GetTokenVaultRequest): Promise<GetTokenVaultResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/token-vaults/${request.tokenVaultId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        token_vault_id: request.tokenVaultId,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetTokenVaultResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新令牌保管库配置
   *
   * Updates the token vault configuration including KMS and policy engine settings.
   */
  public async updateTokenVault(request: UpdateTokenVaultRequest): Promise<UpdateTokenVaultResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/token-vaults/${request.tokenVaultId}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        token_vault_id: request.tokenVaultId,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdateTokenVaultResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Create workload access token (not acting on behalf of a user)
   *
   * Retrieves a workload access token for agentic workloads that do not act on behalf of a user
   */
  public async createWorkloadAccessToken(request: CreateWorkloadAccessTokenRequest): Promise<CreateWorkloadAccessTokenResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/workload-access-token',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateWorkloadAccessTokenResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Create workload access token using JWT (acting on behalf of a user)
   *
   * Retrieves a workload access token for agentic workloads acting on behalf of a user, using a JWT token
   */
  public async createWorkloadAccessTokenForJwt(request: CreateWorkloadAccessTokenForJwtRequest): Promise<CreateWorkloadAccessTokenForJwtResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/workload-access-token-for-jwt',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateWorkloadAccessTokenForJwtResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * Create workload access token using user ID (acting on behalf of a user)
   *
   * Retrieves a workload access token for agentic workloads acting on behalf of a user, using the user&#39;s ID
   */
  public async createWorkloadAccessTokenForUserId(request: CreateWorkloadAccessTokenForUserIdRequest): Promise<CreateWorkloadAccessTokenForUserIdResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/workload-access-token-for-user-id',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateWorkloadAccessTokenForUserIdResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 创建工作负载身份
   *
   * Creates a new workload identity.
   */
  public async createWorkloadIdentity(request: CreateWorkloadIdentityRequest): Promise<CreateWorkloadIdentityResponse> {
    const options: HttpRequestOptions = {
      method: 'POST',
      url: '/v1/workload-identities',
      contentType: 'application/json',
      queryParams: {},
      pathParams: {},
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = CreateWorkloadIdentityResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 删除工作负载身份
   *
   * Deletes a workload identity.
   */
  public async deleteWorkloadIdentity(request: DeleteWorkloadIdentityRequest): Promise<DeleteWorkloadIdentityResponse> {
    const options: HttpRequestOptions = {
      method: 'DELETE',
      url: `/v1/workload-identities/${request.workloadIdentityName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        workload_identity_name: request.workloadIdentityName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = DeleteWorkloadIdentityResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询工作负载身份详情
   *
   * Gets details of a workload identity.
   */
  public async getWorkloadIdentity(request: GetWorkloadIdentityRequest): Promise<GetWorkloadIdentityResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/workload-identities/${request.workloadIdentityName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        workload_identity_name: request.workloadIdentityName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetWorkloadIdentityResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询工作负载身份的授权配置
   *
   * Gets the authorizer configuration of a workload identity.
   */
  public async getWorkloadIdentityAuthorizerConfiguration(request: GetWorkloadIdentityAuthorizerConfigurationRequest): Promise<GetWorkloadIdentityAuthorizerConfigurationResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: `/v1/workload-identities/${request.workloadIdentityName}/authorizer-configuration`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        workload_identity_name: request.workloadIdentityName,
      },
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = GetWorkloadIdentityAuthorizerConfigurationResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 查询工作负载身份列表
   *
   * Lists workload identities.
   */
  public async listWorkloadIdentities(request: ListWorkloadIdentitiesRequest): Promise<ListWorkloadIdentitiesResponse> {
    const options: HttpRequestOptions = {
      method: 'GET',
      url: '/v1/workload-identities',
      contentType: 'application/json',
      queryParams: compactQuery({
        limit: request.limit,
        marker: request.marker,
      }),
      pathParams: {},
      headers: {},
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = ListWorkloadIdentitiesResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }


  /**
   * 更新工作负载身份
   *
   * Updates an existing workload identity.
   */
  public async updateWorkloadIdentity(request: UpdateWorkloadIdentityRequest): Promise<UpdateWorkloadIdentityResponse> {
    const options: HttpRequestOptions = {
      method: 'PUT',
      url: `/v1/workload-identities/${request.workloadIdentityName}`,
      contentType: 'application/json',
      queryParams: {},
      pathParams: {
        workload_identity_name: request.workloadIdentityName,
      },
      headers: {},
      data: request.body?.toDict(),
    };

    const data = await this.hcClient.sendRequest<any>(options);
    const response = UpdateWorkloadIdentityResponse.fromDict(data);
    response.httpStatusCode = data?.httpStatusCode;
    return response;
  }

  public createApiKeyCredentialProviderInvoker(request: CreateApiKeyCredentialProviderRequest): Invoker<CreateApiKeyCredentialProviderResponse> {
    return new Invoker(this, () => this.createApiKeyCredentialProvider(request));
  }

  public deleteApiKeyCredentialProviderInvoker(request: DeleteApiKeyCredentialProviderRequest): Invoker<DeleteApiKeyCredentialProviderResponse> {
    return new Invoker(this, () => this.deleteApiKeyCredentialProvider(request));
  }

  public getApiKeyCredentialProviderInvoker(request: GetApiKeyCredentialProviderRequest): Invoker<GetApiKeyCredentialProviderResponse> {
    return new Invoker(this, () => this.getApiKeyCredentialProvider(request));
  }

  public listApiKeyCredentialProvidersInvoker(request: ListApiKeyCredentialProvidersRequest): Invoker<ListApiKeyCredentialProvidersResponse> {
    return new Invoker(this, () => this.listApiKeyCredentialProviders(request));
  }

  public updateApiKeyCredentialProviderInvoker(request: UpdateApiKeyCredentialProviderRequest): Invoker<UpdateApiKeyCredentialProviderResponse> {
    return new Invoker(this, () => this.updateApiKeyCredentialProvider(request));
  }

  public completeResourceTokenAuthInvoker(request: CompleteResourceTokenAuthRequest): Invoker<CompleteResourceTokenAuthResponse> {
    return new Invoker(this, () => this.completeResourceTokenAuth(request));
  }

  public getResourceApiKeyInvoker(request: GetResourceApiKeyRequest): Invoker<GetResourceApiKeyResponse> {
    return new Invoker(this, () => this.getResourceApiKey(request));
  }

  public getResourceOauth2TokenInvoker(request: GetResourceOauth2TokenRequest): Invoker<GetResourceOauth2TokenResponse> {
    return new Invoker(this, () => this.getResourceOauth2Token(request));
  }

  public getResourceStsTokenInvoker(request: GetResourceStsTokenRequest): Invoker<GetResourceStsTokenResponse> {
    return new Invoker(this, () => this.getResourceStsToken(request));
  }

  public listIdentityProvidersInvoker(request: ListIdentityProvidersRequest): Invoker<ListIdentityProvidersResponse> {
    return new Invoker(this, () => this.listIdentityProviders(request));
  }

  public oauth2AuthorizeInvoker(request: Oauth2AuthorizeRequest): Invoker<Oauth2AuthorizeResponse> {
    return new Invoker(this, () => this.oauth2Authorize(request));
  }

  public oauth2CallbackInvoker(request: Oauth2CallbackRequest): Invoker<Oauth2CallbackResponse> {
    return new Invoker(this, () => this.oauth2Callback(request));
  }

  public createOauth2CredentialProviderInvoker(request: CreateOauth2CredentialProviderRequest): Invoker<CreateOauth2CredentialProviderResponse> {
    return new Invoker(this, () => this.createOauth2CredentialProvider(request));
  }

  public deleteOauth2CredentialProviderInvoker(request: DeleteOauth2CredentialProviderRequest): Invoker<DeleteOauth2CredentialProviderResponse> {
    return new Invoker(this, () => this.deleteOauth2CredentialProvider(request));
  }

  public getOauth2CredentialProviderInvoker(request: GetOauth2CredentialProviderRequest): Invoker<GetOauth2CredentialProviderResponse> {
    return new Invoker(this, () => this.getOauth2CredentialProvider(request));
  }

  public listOauth2CredentialProvidersInvoker(request: ListOauth2CredentialProvidersRequest): Invoker<ListOauth2CredentialProvidersResponse> {
    return new Invoker(this, () => this.listOauth2CredentialProviders(request));
  }

  public updateOauth2CredentialProviderInvoker(request: UpdateOauth2CredentialProviderRequest): Invoker<UpdateOauth2CredentialProviderResponse> {
    return new Invoker(this, () => this.updateOauth2CredentialProvider(request));
  }

  public createPolicyInvoker(request: CreatePolicyRequest): Invoker<CreatePolicyResponse> {
    return new Invoker(this, () => this.createPolicy(request));
  }

  public deletePolicyInvoker(request: DeletePolicyRequest): Invoker<DeletePolicyResponse> {
    return new Invoker(this, () => this.deletePolicy(request));
  }

  public getPolicyInvoker(request: GetPolicyRequest): Invoker<GetPolicyResponse> {
    return new Invoker(this, () => this.getPolicy(request));
  }

  public listPoliciesInvoker(request: ListPoliciesRequest): Invoker<ListPoliciesResponse> {
    return new Invoker(this, () => this.listPolicies(request));
  }

  public updatePolicyInvoker(request: UpdatePolicyRequest): Invoker<UpdatePolicyResponse> {
    return new Invoker(this, () => this.updatePolicy(request));
  }

  public createPolicyEngineInvoker(request: CreatePolicyEngineRequest): Invoker<CreatePolicyEngineResponse> {
    return new Invoker(this, () => this.createPolicyEngine(request));
  }

  public deletePolicyEngineInvoker(request: DeletePolicyEngineRequest): Invoker<DeletePolicyEngineResponse> {
    return new Invoker(this, () => this.deletePolicyEngine(request));
  }

  public getPolicyEngineInvoker(request: GetPolicyEngineRequest): Invoker<GetPolicyEngineResponse> {
    return new Invoker(this, () => this.getPolicyEngine(request));
  }

  public listPolicyEngineAttachmentsInvoker(request: ListPolicyEngineAttachmentsRequest): Invoker<ListPolicyEngineAttachmentsResponse> {
    return new Invoker(this, () => this.listPolicyEngineAttachments(request));
  }

  public listPolicyEnginesInvoker(request: ListPolicyEnginesRequest): Invoker<ListPolicyEnginesResponse> {
    return new Invoker(this, () => this.listPolicyEngines(request));
  }

  public updatePolicyEngineInvoker(request: UpdatePolicyEngineRequest): Invoker<UpdatePolicyEngineResponse> {
    return new Invoker(this, () => this.updatePolicyEngine(request));
  }

  public createStsCredentialProviderInvoker(request: CreateStsCredentialProviderRequest): Invoker<CreateStsCredentialProviderResponse> {
    return new Invoker(this, () => this.createStsCredentialProvider(request));
  }

  public deleteStsCredentialProviderInvoker(request: DeleteStsCredentialProviderRequest): Invoker<DeleteStsCredentialProviderResponse> {
    return new Invoker(this, () => this.deleteStsCredentialProvider(request));
  }

  public getStsCredentialProviderInvoker(request: GetStsCredentialProviderRequest): Invoker<GetStsCredentialProviderResponse> {
    return new Invoker(this, () => this.getStsCredentialProvider(request));
  }

  public listStsCredentialProvidersInvoker(request: ListStsCredentialProvidersRequest): Invoker<ListStsCredentialProvidersResponse> {
    return new Invoker(this, () => this.listStsCredentialProviders(request));
  }

  public updateStsCredentialProviderInvoker(request: UpdateStsCredentialProviderRequest): Invoker<UpdateStsCredentialProviderResponse> {
    return new Invoker(this, () => this.updateStsCredentialProvider(request));
  }

  public getTokenVaultInvoker(request: GetTokenVaultRequest): Invoker<GetTokenVaultResponse> {
    return new Invoker(this, () => this.getTokenVault(request));
  }

  public updateTokenVaultInvoker(request: UpdateTokenVaultRequest): Invoker<UpdateTokenVaultResponse> {
    return new Invoker(this, () => this.updateTokenVault(request));
  }

  public createWorkloadAccessTokenInvoker(request: CreateWorkloadAccessTokenRequest): Invoker<CreateWorkloadAccessTokenResponse> {
    return new Invoker(this, () => this.createWorkloadAccessToken(request));
  }

  public createWorkloadAccessTokenForJwtInvoker(request: CreateWorkloadAccessTokenForJwtRequest): Invoker<CreateWorkloadAccessTokenForJwtResponse> {
    return new Invoker(this, () => this.createWorkloadAccessTokenForJwt(request));
  }

  public createWorkloadAccessTokenForUserIdInvoker(request: CreateWorkloadAccessTokenForUserIdRequest): Invoker<CreateWorkloadAccessTokenForUserIdResponse> {
    return new Invoker(this, () => this.createWorkloadAccessTokenForUserId(request));
  }

  public createWorkloadIdentityInvoker(request: CreateWorkloadIdentityRequest): Invoker<CreateWorkloadIdentityResponse> {
    return new Invoker(this, () => this.createWorkloadIdentity(request));
  }

  public deleteWorkloadIdentityInvoker(request: DeleteWorkloadIdentityRequest): Invoker<DeleteWorkloadIdentityResponse> {
    return new Invoker(this, () => this.deleteWorkloadIdentity(request));
  }

  public getWorkloadIdentityInvoker(request: GetWorkloadIdentityRequest): Invoker<GetWorkloadIdentityResponse> {
    return new Invoker(this, () => this.getWorkloadIdentity(request));
  }

  public getWorkloadIdentityAuthorizerConfigurationInvoker(request: GetWorkloadIdentityAuthorizerConfigurationRequest): Invoker<GetWorkloadIdentityAuthorizerConfigurationResponse> {
    return new Invoker(this, () => this.getWorkloadIdentityAuthorizerConfiguration(request));
  }

  public listWorkloadIdentitiesInvoker(request: ListWorkloadIdentitiesRequest): Invoker<ListWorkloadIdentitiesResponse> {
    return new Invoker(this, () => this.listWorkloadIdentities(request));
  }

  public updateWorkloadIdentityInvoker(request: UpdateWorkloadIdentityRequest): Invoker<UpdateWorkloadIdentityResponse> {
    return new Invoker(this, () => this.updateWorkloadIdentity(request));
  }
}

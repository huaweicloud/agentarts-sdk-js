/**
 * SWR (SoftWare Repository for Container) Client.
 *
 * Provides a high-level client for interacting with Huawei Cloud SWR.
 * Used for managing container image repositories during deployment.
 */

import { Buffer } from 'node:buffer';
import { Region } from '@huaweicloud/huaweicloud-sdk-core';
import { SwrClient } from '@huaweicloud/huaweicloud-sdk-swr/v2/SwrClient.js';
import { CreateNamespaceRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/CreateNamespaceRequest.js';
import { CreateNamespaceRequestBody } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/CreateNamespaceRequestBody.js';
import { CreateRepoRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/CreateRepoRequest.js';
import { CreateRepoRequestBody } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/CreateRepoRequestBody.js';
import { CreateSecretRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/CreateSecretRequest.js';
import { ShowNamespaceRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/ShowNamespaceRequest.js';
import { ShowRepositoryRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/ShowRepositoryRequest.js';

import { getSwrEndpoint } from '../utils/constant.js';
import { createCredential } from '../utils/metadata.js';
import { getLogger } from '../utils/logging.js';
import { buildUserAgent } from '../utils/user-agent.js';
import { buildSslRequestOptions } from '../utils/http-options.js';

const logger = getLogger('sdk.swr_client');

export class SWRClient {
  private _region: string;
  private _endpoint: string;
  private _swrRegistry: string;
  private _verifySsl: boolean | string;
  private _client?: SwrClient;

  /**
   * @param region Huawei Cloud region (e.g. "cn-north-4").
   * @param endpoint Override SWR endpoint URL.
   * @param verifySsl SSL verification setting (default: true).
   */
  constructor(region: string, endpoint?: string | null, verifySsl: boolean | string = true) {
    this._region = region;
    this._endpoint = endpoint || getSwrEndpoint(region);
    this._swrRegistry = `swr.${region}.myhuaweicloud.com`;
    this._verifySsl = verifySsl;
  }

  private async _getClient(): Promise<SwrClient> {
    if (this._client) {
      return this._client;
    }
    this._client = SwrClient.newBuilder()
      .withCredential(await createCredential())
      .withRegion(new Region(this._region, this._endpoint))
      .withOptions({
        customUserAgent: buildUserAgent(),
        ...buildSslRequestOptions(this._verifySsl),
      })
      .build();
    return this._client;
  }

  /** Get attribute value from an object or plain record safely. */
  static getAttrValue(obj: any, attr: string): any {
    if (obj === undefined || obj === null) {
      return undefined;
    }
    if (typeof obj === 'object' && attr in obj) {
      return obj[attr];
    }
    return undefined;
  }

  /** Get organization details. */
  async getOrganization(organization: string): Promise<Record<string, any> | null> {
    try {
      const client = await this._getClient();
      const request = new ShowNamespaceRequest(undefined, organization);
      const response = await client.showNamespace(request);
      return {
        id: SWRClient.getAttrValue(response, 'id'),
        name: SWRClient.getAttrValue(response, 'name') || organization,
        creator_name: SWRClient.getAttrValue(response, 'creator_name'),
      };
    } catch (error) {
      logger.info(`Organization '${organization}' query failed: ${error}`);
      return null;
    }
  }

  /** Create a new organization. */
  async createOrganization(organization: string): Promise<Record<string, any> | null> {
    try {
      const client = await this._getClient();
      const body = new CreateNamespaceRequestBody(organization);
      const request = new CreateNamespaceRequest().withBody(body);
      await client.createNamespace(request);
      logger.info(`√ Created SWR organization: ${organization}`);
      return await this.getOrganization(organization);
    } catch (error) {
      const errorStr = String(error).toLowerCase();
      if (
        errorStr.includes('already exist') ||
        String(error).includes('已存在') ||
        errorStr.includes('duplicate')
      ) {
        logger.info(`Organization '${organization}' already exists`);
        return await this.getOrganization(organization);
      }
      logger.info(`Failed to create organization '${organization}': ${error}`);
      logger.error(`Failed to create organization '${organization}'`, error);
      return null;
    }
  }

  /** Create or get an organization. */
  async createOrGetOrganization(organization: string): Promise<Record<string, any> | null> {
    const existing = await this.getOrganization(organization);
    if (existing !== null) {
      logger.info(`Organization '${organization}' already exists`);
      return existing;
    }
    return this.createOrganization(organization);
  }

  /** Get repository details. */
  async getRepository(
    organization: string,
    repository: string,
  ): Promise<Record<string, any> | null> {
    try {
      const client = await this._getClient();
      const request = new ShowRepositoryRequest(undefined, organization, repository);
      const response = await client.showRepository(request);
      return {
        name: SWRClient.getAttrValue(response, 'name') || repository,
        namespace: SWRClient.getAttrValue(response, 'namespace') || organization,
        is_public: SWRClient.getAttrValue(response, 'is_public'),
        path: SWRClient.getAttrValue(response, 'path'),
      };
    } catch (error) {
      logger.info(`Repository '${organization}/${repository}' query failed: ${error}`);
      return null;
    }
  }

  /** Create a new repository. */
  async createRepository(
    organization: string,
    repository: string,
    isPublic = false,
  ): Promise<Record<string, any> | null> {
    try {
      const client = await this._getClient();
      const body = new CreateRepoRequestBody(repository, isPublic);
      const request = new CreateRepoRequest(undefined, organization).withBody(body);
      await client.createRepo(request);
      logger.info(`√ Created SWR repository: ${organization}/${repository}`);
      return await this.getRepository(organization, repository);
    } catch (error) {
      const errorStr = String(error).toLowerCase();
      if (
        errorStr.includes('already exist') ||
        String(error).includes('已存在') ||
        errorStr.includes('duplicate')
      ) {
        logger.info(`Repository '${organization}/${repository}' already exists`);
        return await this.getRepository(organization, repository);
      }
      logger.info(`Failed to create repository '${organization}/${repository}': ${error}`);
      return null;
    }
  }

  /** Create or get a repository. */
  async createOrGetRepository(
    organization: string,
    repository: string,
    isPublic = false,
  ): Promise<Record<string, any> | null> {
    const existing = await this.getRepository(organization, repository);
    if (existing !== null) {
      logger.info(`Repository ${organization}/${repository} already exists`);
      return existing;
    }
    return this.createRepository(organization, repository, isPublic);
  }

  /**
   * Create an SWR secret for Docker login.
   *
   * @returns `[loginServer, username, password]`, or `[loginServer, "", ""]` on failure.
   */
  async createSwrSecret(): Promise<[string, string, string]> {
    const loginServer = this._swrRegistry;
    try {
      const client = await this._getClient();
      const request = new CreateSecretRequest();
      request.projectname = this._region.split('.')[0];
      const response = await client.createSecret(request);

      const auths = SWRClient.getAttrValue(response, 'auths');
      const authInfo = SWRClient.getAttrValue(auths, loginServer);
      const authData = SWRClient.getAttrValue(authInfo, 'auth');

      if (authData) {
        const decodedAuth = Buffer.from(String(authData), 'base64').toString('utf-8');
        const separatorIndex = decodedAuth.indexOf(':');
        const username = separatorIndex >= 0 ? decodedAuth.slice(0, separatorIndex) : decodedAuth;
        const password = separatorIndex >= 0 ? decodedAuth.slice(separatorIndex + 1) : '';
        logger.info(`√ Created SWR secret for region: ${this._region}`);
        return [loginServer, username, password];
      }

      logger.warning('No auth data found in SWR secret response');
      return [loginServer, '', ''];
    } catch (error) {
      logger.info(`Failed to create SWR secret: ${error}`);
      return [loginServer, '', ''];
    }
  }

  /** Get the full SWR image name. */
  getFullImageName(organization: string, repository: string, tag = 'latest'): string {
    return `${this._swrRegistry}/${organization}/${repository}:${tag}`;
  }
}



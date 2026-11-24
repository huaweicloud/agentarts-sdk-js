/**
 * SDK Request Signing Utilities.
 *
 * Provides signing utilities for Huawei Cloud API requests (SDK-HMAC-SHA256).
 */

import { createHash } from 'node:crypto';

import { AKSKSigner } from '@huaweicloud/huaweicloud-sdk-core/auth/AKSKSigner.js';
import { BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';
import type { IHttpRequest } from '@huaweicloud/huaweicloud-sdk-core/http/IHttpRequest.js';

import { createCredential } from './metadata.js';

export class SDKSigner {
  private _credentials?: BasicCredentials;

  /**
   * @param credentials Huawei Cloud credentials. If not provided they are
   *   loaded lazily from the environment/profile/metadata chain.
   */
  constructor(credentials?: BasicCredentials) {
    this._credentials = credentials;
  }

  get credentials(): BasicCredentials | undefined {
    return this._credentials;
  }

  private async ensureCredentials(): Promise<BasicCredentials> {
    if (!this._credentials) {
      this._credentials = await createCredential();
    }
    return this._credentials;
  }

  private _getSecurityToken(): string | undefined {
    const credentials: any = this._credentials;
    return credentials?.securityToken ?? credentials?.security_token ?? undefined;
  }

  /**
   * Sign an HTTP request.
   *
   * @param method HTTP method (GET, POST, ...).
   * @param url Full URL.
   * @param headers Request headers (updated with the signature).
   * @param body Request body as string.
   * @param queryParams Query parameters as `[key, value]` pairs.
   * @returns The updated headers.
   */
  async sign(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | null,
    queryParams?: Array<[string, any]> | null,
  ): Promise<Record<string, string>> {
    const credentials = await this.ensureCredentials();

    const query: Record<string, any> = {};
    for (const [key, value] of queryParams ?? []) {
      query[key] = value;
    }

    // core serializes request.data again; hash the actual outgoing bytes instead.
    let explicitHash: string | undefined;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'x-sdk-content-sha256') {
        explicitHash = headers[key];
        delete headers[key];
      }
    }
    headers['X-Sdk-Content-Sha256'] =
      explicitHash ??
      createHash('sha256')
        .update(body ?? '', 'utf8')
        .digest('hex');

    const request: IHttpRequest = {
      method,
      endpoint: url,
      headers: { ...headers },
      data: body ?? undefined,
      queryParams: query,
    };

    const signedHeaders = AKSKSigner.sign(request, credentials);
    Object.assign(headers, signedHeaders);

    const securityToken = this._getSecurityToken();
    if (securityToken) {
      headers['X-Security-Token'] = securityToken;
    }

    return headers;
  }
}

/** Create an SDK signer instance. */
export function createSdkSigner(credentials?: BasicCredentials): SDKSigner {
  return new SDKSigner(credentials);
}

/**
 * Sign an HTTP request using SDK-HMAC-SHA256.
 *
 * Convenience wrapper that creates a signer and signs the request.
 */
export async function signRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | null,
  queryParams?: Record<string, any> | null,
  credentials?: BasicCredentials,
): Promise<Record<string, string>> {
  const signer = new SDKSigner(credentials);
  const paramsList = queryParams ? Object.entries(queryParams) : undefined;
  return signer.sign(method, url, headers, body, paramsList);
}

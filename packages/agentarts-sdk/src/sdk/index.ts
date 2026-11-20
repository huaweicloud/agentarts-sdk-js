/**
 * Huawei Cloud AgentArts SDK.
 *
 * Build, deploy and manage AI agents with cloud capabilities.
 *
 * Quick start:
 * ```ts
 * import { AgentArtsRuntimeApp, RequestContext } from 'agentarts-sdk';
 * import { CodeInterpreter, codeSession } from 'agentarts-sdk';
 * import { MemoryClient, AsyncMemoryClient } from 'agentarts-sdk';
 * import { GatewayClient } from 'agentarts-sdk';
 * import { requireAccessToken, requireApiKey, IdentityClient } from 'agentarts-sdk';
 * ```
 */

import { __author__, __version__ } from '../version.js';
import { GatewayClient } from './gateway/index.js';
import {
  IdentityClient,
  OAuth2Vendor,
  requireAccessToken,
  requireApiKey,
  requireStsToken,
} from './identity/index.js';
import type { StsCredentials } from './identity/index.js';
import { AsyncMemoryClient, MemoryClient } from './memory/index.js';
import { AgentArtsRuntimeApp, AgentArtsRuntimeContext, PingStatus, RequestContext } from './runtime/index.js';
import {
  Browser,
  BrowserSession,
  CodeInterpreter,
  CodeSession,
  SUPPORTED_CODE_LANGUAGES,
  browserSession,
  codeSession,
  withBrowserSession,
  withCodeSession,
} from './tools/index.js';
import type { CodeLanguage } from './tools/index.js';

export {
  AgentArtsRuntimeApp,
  AgentArtsRuntimeContext,
  AsyncMemoryClient,
  Browser,
  BrowserSession,
  CodeInterpreter,
  CodeSession,
  GatewayClient,
  IdentityClient,
  MemoryClient,
  OAuth2Vendor,
  PingStatus,
  RequestContext,
  SUPPORTED_CODE_LANGUAGES,
  __author__,
  __version__,
  browserSession,
  codeSession,
  requireAccessToken,
  requireApiKey,
  requireStsToken,
  withBrowserSession,
  withCodeSession,
};

export type { CodeLanguage, StsCredentials };

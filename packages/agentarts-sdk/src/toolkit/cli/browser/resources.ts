/** browser CLI definitions: parameters/interaction only, calls the operations layer. */
import { Command } from 'commander';
import type { Browser } from '../../../sdk/tools/browser/browser-client.js';
import * as operations from '../../operations/browser/index.js';
import { registerOperationCommands } from '../operation-commands.js';
import type { OperationCommand } from '../operation-commands.js';

export const browserCommands: OperationCommand[] = [
  {
    name: 'create',
    method: 'createBrowser',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true, positional: true },
      { key: 'authType', flag: 'auth-type', kind: 'string', required: false },
      { key: 'apiKeyName', flag: 'api-key-name', kind: 'string', required: false },
      { key: 'description', flag: 'description', kind: 'string', required: false },
      {
        key: 'executionAgencyName',
        flag: 'execution-agency-name',
        kind: 'string',
        required: false,
      },
      { key: 'observability', flag: 'observability', kind: 'object', required: false },
      { key: 'networkConfig', flag: 'network-config', kind: 'object', required: false },
      { key: 'agentGatewayId', flag: 'agent-gateway-id', kind: 'string', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createBrowser(args as Parameters<Browser['createBrowser']>, options),
  },
  {
    name: 'list',
    method: 'listBrowsers',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: false },
      { key: 'offset', flag: 'offset', kind: 'number', required: false },
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'sortKey', flag: 'sort-key', kind: 'string', required: false },
      { key: 'sortDir', flag: 'sort-dir', kind: 'string', required: false },
      {
        key: 'tagKeyExists',
        flag: 'tag-key-exists',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagKeyMatches',
        flag: 'tag-key-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagValueMatches',
        flag: 'tag-value-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      { key: 'tagMatchPolicy', flag: 'tag-match-policy', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listBrowsers(args as Parameters<Browser['listBrowsers']>, options),
  },
  {
    name: 'get',
    method: 'getBrowser',
    fields: [
      { key: 'browserId', flag: 'browser-id', kind: 'string', required: true, positional: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getBrowser(args as Parameters<Browser['getBrowser']>, options),
  },
  {
    name: 'update',
    method: 'updateBrowser',
    fields: [
      { key: 'browserId', flag: 'browser-id', kind: 'string', required: true, positional: true },
      { key: 'observability', flag: 'observability', kind: 'object', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.updateBrowser(args as Parameters<Browser['updateBrowser']>, options),
  },
  {
    name: 'delete',
    method: 'deleteBrowser',
    fields: [
      { key: 'browserId', flag: 'browser-id', kind: 'string', required: true, positional: true },
    ],
    destructive: true,
    session: false,
    run: (args, options) =>
      operations.deleteBrowser(args as Parameters<Browser['deleteBrowser']>, options),
  },
  {
    name: 'create-profile',
    method: 'createBrowserProfile',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: true, positional: true },
      { key: 'description', flag: 'description', kind: 'string', required: false },
      { key: 'tags', flag: 'tags', kind: 'array', items: 'object', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.createBrowserProfile(args as Parameters<Browser['createBrowserProfile']>, options),
  },
  {
    name: 'list-profiles',
    method: 'listBrowserProfiles',
    fields: [
      { key: 'name', flag: 'name', kind: 'string', required: false },
      { key: 'offset', flag: 'offset', kind: 'number', required: false },
      { key: 'limit', flag: 'limit', kind: 'number', required: false },
      { key: 'sortKey', flag: 'sort-key', kind: 'string', required: false },
      { key: 'sortDir', flag: 'sort-dir', kind: 'string', required: false },
      {
        key: 'tagKeyExists',
        flag: 'tag-key-exists',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagKeyMatches',
        flag: 'tag-key-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'tagValueMatches',
        flag: 'tag-value-matches',
        kind: 'array',
        items: 'string',
        required: false,
      },
      { key: 'tagMatchPolicy', flag: 'tag-match-policy', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.listBrowserProfiles(args as Parameters<Browser['listBrowserProfiles']>, options),
  },
  {
    name: 'get-profile',
    method: 'getBrowserProfile',
    fields: [
      { key: 'profileId', flag: 'profile-id', kind: 'string', required: true, positional: true },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.getBrowserProfile(args as Parameters<Browser['getBrowserProfile']>, options),
  },
  {
    name: 'delete-profile',
    method: 'deleteBrowserProfile',
    fields: [
      { key: 'profileId', flag: 'profile-id', kind: 'string', required: true, positional: true },
    ],
    destructive: true,
    session: false,
    run: (args, options) =>
      operations.deleteBrowserProfile(args as Parameters<Browser['deleteBrowserProfile']>, options),
  },
  {
    name: 'start-session',
    method: 'startSession',
    fields: [
      {
        key: 'browserName',
        flag: 'browser-name',
        kind: 'string',
        required: true,
        positional: true,
      },
      { key: 'sessionName', flag: 'session-name', kind: 'string', required: true },
      { key: 'sessionId', flag: 'session-id', kind: 'string', required: false },
      { key: 'viewport', flag: 'viewport', kind: 'object', required: false },
      {
        key: 'profileConfiguration',
        flag: 'profile-configuration',
        kind: 'object',
        required: false,
      },
      {
        key: 'allowedDomains',
        flag: 'allowed-domains',
        kind: 'array',
        items: 'string',
        required: false,
      },
      {
        key: 'blockedDomains',
        flag: 'blocked-domains',
        kind: 'array',
        items: 'string',
        required: false,
      },
      { key: 'proxyConfiguration', flag: 'proxy-configuration', kind: 'object', required: false },
      { key: 'sessionTimeout', flag: 'session-timeout', kind: 'number', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: false,
    run: (args, options) =>
      operations.startSession(args as Parameters<Browser['startSession']>, options),
  },
  {
    name: 'stop-session',
    method: 'stopSession',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.stopSession(args as Parameters<Browser['stopSession']>, options),
  },
  {
    name: 'get-session',
    method: 'getSession',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.getSession(args as Parameters<Browser['getSession']>, options),
  },
  {
    name: 'save-profile',
    method: 'saveProfile',
    legacyResourceFirst: true,
    fields: [
      { key: 'profileId', flag: 'profile-id', kind: 'string', required: true, positional: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.saveProfile(args as Parameters<Browser['saveProfile']>, options),
  },
  {
    name: 'update-stream',
    method: 'updateStream',
    fields: [
      { key: 'streamStatus', flag: 'stream-status', kind: 'string', required: true },
      { key: 'clientToken', flag: 'client-token', kind: 'string', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.updateStream(args as Parameters<Browser['updateStream']>, options),
  },
  {
    name: 'take-control',
    method: 'takeControl',
    fields: [
      { key: 'clientToken', flag: 'client-token', kind: 'string', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.takeControl(args as Parameters<Browser['takeControl']>, options),
  },
  {
    name: 'release-control',
    method: 'releaseControl',
    fields: [
      { key: 'clientToken', flag: 'client-token', kind: 'string', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.releaseControl(args as Parameters<Browser['releaseControl']>, options),
  },
  {
    name: 'invoke',
    method: 'invoke',
    fields: [
      { key: 'type', flag: 'type', kind: 'string', required: true },
      { key: 'action', flag: 'action', kind: 'object', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.invoke(args as Parameters<Browser['invoke']>, options),
  },
  {
    name: 'mouse-click',
    method: 'mouseClick',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'button', flag: 'button', kind: 'string', required: false },
      { key: 'clickCount', flag: 'click-count', kind: 'number', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.mouseClick(args as Parameters<Browser['mouseClick']>, options),
  },
  {
    name: 'left-mouse-click',
    method: 'leftMouseClick',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.leftMouseClick(args as Parameters<Browser['leftMouseClick']>, options),
  },
  {
    name: 'right-mouse-click',
    method: 'rightMouseClick',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.rightMouseClick(args as Parameters<Browser['rightMouseClick']>, options),
  },
  {
    name: 'double-mouse-click',
    method: 'doubleMouseClick',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.doubleMouseClick(args as Parameters<Browser['doubleMouseClick']>, options),
  },
  {
    name: 'mouse-move',
    method: 'mouseMove',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.mouseMove(args as Parameters<Browser['mouseMove']>, options),
  },
  {
    name: 'mouse-drag',
    method: 'mouseDrag',
    fields: [
      { key: 'startX', flag: 'start-x', kind: 'number', required: true },
      { key: 'startY', flag: 'start-y', kind: 'number', required: true },
      { key: 'endX', flag: 'end-x', kind: 'number', required: true },
      { key: 'endY', flag: 'end-y', kind: 'number', required: true },
      { key: 'button', flag: 'button', kind: 'string', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.mouseDrag(args as Parameters<Browser['mouseDrag']>, options),
  },
  {
    name: 'mouse-scroll',
    method: 'mouseScroll',
    fields: [
      { key: 'x', flag: 'x', kind: 'number', required: true },
      { key: 'y', flag: 'y', kind: 'number', required: true },
      { key: 'deltaX', flag: 'delta-x', kind: 'number', required: false },
      { key: 'deltaY', flag: 'delta-y', kind: 'number', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.mouseScroll(args as Parameters<Browser['mouseScroll']>, options),
  },
  {
    name: 'key-press',
    method: 'keyPress',
    fields: [
      { key: 'key', flag: 'key', kind: 'string', required: true },
      { key: 'presses', flag: 'presses', kind: 'number', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.keyPress(args as Parameters<Browser['keyPress']>, options),
  },
  {
    name: 'key-type',
    method: 'keyType',
    fields: [
      { key: 'text', flag: 'text', kind: 'string', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.keyType(args as Parameters<Browser['keyType']>, options),
  },
  {
    name: 'key-shortcut',
    method: 'keyShortcut',
    fields: [
      { key: 'keys', flag: 'keys', kind: 'array', items: 'string', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.keyShortcut(args as Parameters<Browser['keyShortcut']>, options),
  },
  {
    name: 'navigate',
    method: 'navigate',
    fields: [
      { key: 'url', flag: 'url', kind: 'string', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.navigate(args as Parameters<Browser['navigate']>, options),
  },
  {
    name: 'go-back',
    method: 'goBack',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.goBack(args as Parameters<Browser['goBack']>, options),
  },
  {
    name: 'go-forward',
    method: 'goForward',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.goForward(args as Parameters<Browser['goForward']>, options),
  },
  {
    name: 'refresh',
    method: 'refresh',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.refresh(args as Parameters<Browser['refresh']>, options),
  },
  {
    name: 'get-page-info',
    method: 'getPageInfo',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.getPageInfo(args as Parameters<Browser['getPageInfo']>, options),
  },
  {
    name: 'screenshot',
    method: 'screenshot',
    fields: [
      { key: 'format', flag: 'format', kind: 'string', required: false },
      { key: 'quality', flag: 'quality', kind: 'number', required: false },
      { key: 'fullPage', flag: 'full-page', kind: 'boolean', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) =>
      operations.screenshot(args as Parameters<Browser['screenshot']>, options),
  },
  {
    name: 'wait',
    method: 'wait',
    fields: [
      { key: 'duration', flag: 'duration', kind: 'number', required: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.wait(args as Parameters<Browser['wait']>, options),
  },
  {
    name: 'list-tabs',
    method: 'listTabs',
    fields: [{ key: 'apiKey', flag: 'api-key', kind: 'string', required: false }],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.listTabs(args as Parameters<Browser['listTabs']>, options),
  },
  {
    name: 'switch-tab',
    method: 'switchTab',
    fields: [
      { key: 'tabId', flag: 'tab-id', kind: 'string', required: true, positional: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.switchTab(args as Parameters<Browser['switchTab']>, options),
  },
  {
    name: 'close-tab',
    method: 'closeTab',
    fields: [
      { key: 'tabId', flag: 'tab-id', kind: 'string', required: false, positional: true },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.closeTab(args as Parameters<Browser['closeTab']>, options),
  },
  {
    name: 'new-tab',
    method: 'newTab',
    fields: [
      { key: 'url', flag: 'url', kind: 'string', required: false },
      { key: 'apiKey', flag: 'api-key', kind: 'string', required: false },
    ],
    destructive: false,
    session: true,
    sessionPositionals: true,
    run: (args, options) => operations.newTab(args as Parameters<Browser['newTab']>, options),
  },
];

export function registerResourceCommands(command: Command): void {
  registerOperationCommands(command, browserCommands, { region: true });
}

export function createResourceCommand(): Command {
  const command = new Command('browser').description('browser resource and session management');
  registerResourceCommands(command);
  return command;
}

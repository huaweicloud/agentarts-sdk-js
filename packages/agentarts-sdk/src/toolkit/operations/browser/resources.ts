/** browser SDK business operations, returning structured results. */
import { Browser } from '../../../sdk/tools/browser/browser-client.js';
import { getRegion, getControlPlaneEndpoint } from '../../../sdk/utils/constant.js';
import { executeOperation } from '../common.js';
import type { OperationOptions } from '../common.js';

/** Operation counterpart of Browser.createBrowser. */
export function createBrowser(
  args: Parameters<Browser['createBrowser']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createBrowser(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.listBrowsers. */
export function listBrowsers(
  args: Parameters<Browser['listBrowsers']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.listBrowsers(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.getBrowser. */
export function getBrowser(
  args: Parameters<Browser['getBrowser']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getBrowser(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.updateBrowser. */
export function updateBrowser(
  args: Parameters<Browser['updateBrowser']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.updateBrowser(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.deleteBrowser. */
export function deleteBrowser(
  args: Parameters<Browser['deleteBrowser']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.deleteBrowser(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.createBrowserProfile. */
export function createBrowserProfile(
  args: Parameters<Browser['createBrowserProfile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.createBrowserProfile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.listBrowserProfiles. */
export function listBrowserProfiles(
  args: Parameters<Browser['listBrowserProfiles']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.listBrowserProfiles(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.getBrowserProfile. */
export function getBrowserProfile(
  args: Parameters<Browser['getBrowserProfile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.getBrowserProfile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.deleteBrowserProfile. */
export function deleteBrowserProfile(
  args: Parameters<Browser['deleteBrowserProfile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.deleteBrowserProfile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.startSession. */
export function startSession(
  args: Parameters<Browser['startSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      const value = await client.startSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.stopSession. */
export function stopSession(
  args: Parameters<Browser['stopSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.stopSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.getSession. */
export function getSession(
  args: Parameters<Browser['getSession']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.getSession(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.saveProfile. */
export function saveProfile(
  args: Parameters<Browser['saveProfile']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.saveProfile(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.updateStream. */
export function updateStream(
  args: Parameters<Browser['updateStream']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.updateStream(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.takeControl. */
export function takeControl(
  args: Parameters<Browser['takeControl']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.takeControl(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.releaseControl. */
export function releaseControl(
  args: Parameters<Browser['releaseControl']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.releaseControl(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.invoke. */
export function invoke(args: Parameters<Browser['invoke']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.invoke(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.mouseClick. */
export function mouseClick(
  args: Parameters<Browser['mouseClick']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.mouseClick(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.leftMouseClick. */
export function leftMouseClick(
  args: Parameters<Browser['leftMouseClick']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.leftMouseClick(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.rightMouseClick. */
export function rightMouseClick(
  args: Parameters<Browser['rightMouseClick']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.rightMouseClick(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.doubleMouseClick. */
export function doubleMouseClick(
  args: Parameters<Browser['doubleMouseClick']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.doubleMouseClick(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.mouseMove. */
export function mouseMove(args: Parameters<Browser['mouseMove']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.mouseMove(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.mouseDrag. */
export function mouseDrag(args: Parameters<Browser['mouseDrag']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.mouseDrag(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.mouseScroll. */
export function mouseScroll(
  args: Parameters<Browser['mouseScroll']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.mouseScroll(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.keyPress. */
export function keyPress(args: Parameters<Browser['keyPress']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.keyPress(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.keyType. */
export function keyType(args: Parameters<Browser['keyType']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.keyType(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.keyShortcut. */
export function keyShortcut(
  args: Parameters<Browser['keyShortcut']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.keyShortcut(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.navigate. */
export function navigate(args: Parameters<Browser['navigate']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.navigate(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.goBack. */
export function goBack(args: Parameters<Browser['goBack']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.goBack(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.goForward. */
export function goForward(args: Parameters<Browser['goForward']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.goForward(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.refresh. */
export function refresh(args: Parameters<Browser['refresh']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.refresh(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.getPageInfo. */
export function getPageInfo(
  args: Parameters<Browser['getPageInfo']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.getPageInfo(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.screenshot. */
export function screenshot(
  args: Parameters<Browser['screenshot']>,
  options: OperationOptions = {},
) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.screenshot(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.wait. */
export function wait(args: Parameters<Browser['wait']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.wait(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.listTabs. */
export function listTabs(args: Parameters<Browser['listTabs']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.listTabs(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.switchTab. */
export function switchTab(args: Parameters<Browser['switchTab']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.switchTab(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.closeTab. */
export function closeTab(args: Parameters<Browser['closeTab']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.closeTab(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

/** Operation counterpart of Browser.newTab. */
export function newTab(args: Parameters<Browser['newTab']>, options: OperationOptions = {}) {
  return executeOperation(
    () =>
      new Browser(
        options.region ?? null,
        options.dataEndpoint ?? null,
        options.authType ?? 'API_KEY',
        !options.skipSslVerification,
      ),
    async (client) => {
      if (!options.resourceName || !options.sessionId)
        throw new Error('--resource-name and --session-id are required for an existing session');
      client.browserName = options.resourceName;
      client.sessionId = options.sessionId;
      const value = await client.newTab(...args);
      return value;
    },
    async (client) => {
      client.controlPlaneClient.close();
      client._dataPlaneClient.close();
    },
  );
}

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const p = (rel: string): string => resolve(root, rel);

export default [
  { find: /^@huaweicloud\/agentarts-sdk$/, replacement: p('packages/agentarts-sdk/src/index.ts') },
  { find: /^@huaweicloud\/agentarts-sdk\/(.*)$/, replacement: p('packages/agentarts-sdk/src/$1') },
  { find: /^agentarts-sdk$/, replacement: p('packages/agentarts-sdk/src/index.ts') },
  { find: /^agentarts-sdk\/sdk$/, replacement: p('packages/agentarts-sdk/src/sdk/index.ts') },
  {
    find: /^agentarts-sdk\/toolkit$/,
    replacement: p('packages/agentarts-sdk/src/toolkit/index.ts'),
  },
  { find: /^agentarts-sdk\/(.*)$/, replacement: p('packages/agentarts-sdk/src/$1') },
  // AgentIdentity 底座：同时兼容新（scoped）与旧的包名，确保源码与测试共享同一模块实例。
  {
    find: /^@huaweicloud\/huaweicloud-sdk-agentidentity$/,
    replacement: p('packages/huaweicloud-sdk-agentidentity/src/index.ts'),
  },
  {
    find: /^huaweicloud-sdk-agentidentity$/,
    replacement: p('packages/huaweicloud-sdk-agentidentity/src/index.ts'),
  },
];

# SDK、Operations 与 CLI 对应关系

当前所有可独立调用的 SDK 业务方法均通过 CLI → Operations → SDK 分层暴露。
CLI 只处理参数、交互确认、文件输入输出和展示；Operations 创建客户端、调用 SDK、封装 success/data/error，并在 SDK 暴露关闭方法时清理连接。

## 命令入口与认证

在仓库根目录执行 `pnpm build` 后使用 `pnpm cli ...`。

| 分组 | SDK | Operations | CLI 情况 |
| --- | --- | --- | --- |
| memory | MemoryClient（19 个业务方法） | operations/memory | 空间 5 个既有命令 + 14 个数据面命令；status 为详情展示 |
| gateway | GatewayClient（10 个业务方法） | operations/gateway | 既有 10 个命令全部接入 Operations |
| runtime | RuntimeClient（17 个业务方法）及 LocalRuntimeClient | operations/runtime | 保留 6 个云端会话/调用命令与顶层部署、invoke、destroy；新增 11 个资源命令和本地 ping |
| identity | IdentityClient（18 个业务方法） | operations/identity | 新增 18 个命令 |
| browser | Browser（38 个业务操作） | operations/browser | 新增资源、Profile、会话及自动化命令 |
| code-interpreter | CodeInterpreter（17 个业务方法） | operations/code-interpreter | 新增资源、会话、代码执行及文件操作命令 |
| iam | IAMClient（5 个业务方法） | operations/iam | 独立管理入口；部署内部仍复用 IAM SDK |
| swr | SWRClient（7 个云端业务方法） | operations/swr | 独立管理入口；部署内部仍复用 SWR SDK |

控制面复用 HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK / HUAWEICLOUD_SDK_REGION。
Memory 数据面使用 HUAWEICLOUD_SDK_MEMORY_API_KEY；浏览器和代码沙箱分别使用 HUAWEICLOUD_SDK_BROWSER_API_KEY 和 HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY，也可通过 SDK 支持的 IAM 模式访问。
IAMClient 从 SDK 环境变量解析区域，因此 iam 命令不提供会被忽略的 --region。

## 新增入口的参数规则

- Browser、Code Interpreter 的实体 ID 使用必填位置参数，Browser Profile 的查询、删除和保存也使用位置参数 profileId；旧 --xxx-id 和请求文件仍兼容，其余参数使用命名选项。不同来源同时传入 ID 时必须一致。既有 Gateway、Memory 命令保持原调用方式。
- 对象、数组参数使用 JSON；--options 使用 SDK 的 camelCase 属性。可用 --request-file 从 JSON 文件读取方法参数，并用显式选项覆盖。
- 布尔参数传入 true/false，例如 --only-attached false。
- 支持 -o json、-k、--output-file；新建及覆盖的输出文件在写入前收紧为 0600 权限；二进制下载到 --output-file 保留原字节，代码沙箱 upload-file 可用 --content-file 读取二进制。
- Code Interpreter 启动会话使用 <codeInterpreterName>，后续操作使用 <codeInterpreterName> <sessionId>；旧命名选项兼容。Browser 后续会话操作使用 <browserName> <sessionId>，兼容旧 --resource-name/--session-id。两者均不隐式创建新会话，start-session 单独执行。
- 删除和重置命令默认确认，脚本中显式传 --force。
- 新增入口默认输出原业务数据，失败设置非零退出码；不自动隐藏用户明确请求的密钥或令牌。需要避免在终端历史中填写凭据时使用受限权限的 --request-file。
- OAuth 用户授权命令将授权 URL 输出到 stderr，并使用 SDK 的轮询；回调可由另一终端执行 complete-resource-token-auth。JSON 不能表达自定义函数和 TokenPoller。

```bash
pnpm cli runtime list --options '{"limit":10}'
pnpm cli runtime get --agent-name my-agent
pnpm cli runtime get-endpoint --agent-id AGENT_ID --endpoint-name default
pnpm cli identity list-workload-identities --limit 5
pnpm cli browser list --limit 5
pnpm cli code-interpreter list --limit 5
pnpm cli iam list-policies --limit 5
pnpm cli swr get-organization --organization my-org

# 使用已有会话（需要实际数据面地址和 API Key）
pnpm cli browser navigate my-browser SESSION_ID --url https://example.com
pnpm cli code-interpreter execute-code my-tool SESSION_ID --code 'print(1 + 1)'
```

## 资源及工具方法映射

| SDK 方法 | CLI 命令 |
| --- | --- |
| createWorkloadIdentity | `agentarts identity create-workload-identity` |
| updateWorkloadIdentity | `agentarts identity update-workload-identity` |
| getWorkloadIdentity | `agentarts identity get-workload-identity` |
| listWorkloadIdentities | `agentarts identity list-workload-identities` |
| createApiKeyCredentialProvider | `agentarts identity create-api-key-credential-provider` |
| createOauth2CredentialProvider | `agentarts identity create-oauth2-credential-provider` |
| createStsCredentialProvider | `agentarts identity create-sts-credential-provider` |
| createWorkloadAccessToken | `agentarts identity create-workload-access-token` |
| getApiKeyCredentialProvider | `agentarts identity get-api-key-credential-provider` |
| listApiKeyCredentialProviders | `agentarts identity list-api-key-credential-providers` |
| getOauth2CredentialProvider | `agentarts identity get-oauth2-credential-provider` |
| listOauth2CredentialProviders | `agentarts identity list-oauth2-credential-providers` |
| getStsCredentialProvider | `agentarts identity get-sts-credential-provider` |
| listStsCredentialProviders | `agentarts identity list-sts-credential-providers` |
| getResourceOauth2Token | `agentarts identity get-resource-oauth2-token` |
| getResourceApiKey | `agentarts identity get-resource-api-key` |
| getResourceStsToken | `agentarts identity get-resource-sts-token` |
| completeResourceTokenAuth | `agentarts identity complete-resource-token-auth` |
| createBrowser | `agentarts browser create` |
| listBrowsers | `agentarts browser list` |
| getBrowser | `agentarts browser get` |
| updateBrowser | `agentarts browser update` |
| deleteBrowser | `agentarts browser delete` |
| createBrowserProfile | `agentarts browser create-profile` |
| listBrowserProfiles | `agentarts browser list-profiles` |
| getBrowserProfile | `agentarts browser get-profile` |
| deleteBrowserProfile | `agentarts browser delete-profile` |
| startSession | `agentarts browser start-session` |
| stopSession | `agentarts browser stop-session` |
| getSession | `agentarts browser get-session` |
| saveProfile | `agentarts browser save-profile` |
| updateStream | `agentarts browser update-stream` |
| takeControl | `agentarts browser take-control` |
| releaseControl | `agentarts browser release-control` |
| invoke | `agentarts browser invoke` |
| mouseClick | `agentarts browser mouse-click` |
| leftMouseClick | `agentarts browser left-mouse-click` |
| rightMouseClick | `agentarts browser right-mouse-click` |
| doubleMouseClick | `agentarts browser double-mouse-click` |
| mouseMove | `agentarts browser mouse-move` |
| mouseDrag | `agentarts browser mouse-drag` |
| mouseScroll | `agentarts browser mouse-scroll` |
| keyPress | `agentarts browser key-press` |
| keyType | `agentarts browser key-type` |
| keyShortcut | `agentarts browser key-shortcut` |
| navigate | `agentarts browser navigate` |
| goBack | `agentarts browser go-back` |
| goForward | `agentarts browser go-forward` |
| refresh | `agentarts browser refresh` |
| getPageInfo | `agentarts browser get-page-info` |
| screenshot | `agentarts browser screenshot` |
| wait | `agentarts browser wait` |
| listTabs | `agentarts browser list-tabs` |
| switchTab | `agentarts browser switch-tab` |
| closeTab | `agentarts browser close-tab` |
| newTab | `agentarts browser new-tab` |
| createCodeInterpreter | `agentarts code-interpreter create` |
| listCodeInterpreters | `agentarts code-interpreter list` |
| updateCodeInterpreter | `agentarts code-interpreter update` |
| getCodeInterpreter | `agentarts code-interpreter get` |
| deleteCodeInterpreter | `agentarts code-interpreter delete` |
| startSession | `agentarts code-interpreter start-session` |
| getSession | `agentarts code-interpreter get-session` |
| stopSession | `agentarts code-interpreter stop-session` |
| invoke | `agentarts code-interpreter invoke` |
| executeCode | `agentarts code-interpreter execute-code` |
| executeCommand | `agentarts code-interpreter execute-command` |
| uploadFile | `agentarts code-interpreter upload-file` |
| uploadFiles | `agentarts code-interpreter upload-files` |
| downloadFile | `agentarts code-interpreter download-file` |
| downloadFiles | `agentarts code-interpreter download-files` |
| installPackages | `agentarts code-interpreter install-packages` |
| clearContext | `agentarts code-interpreter clear-context` |
| createAgency | `agentarts iam create-agency` |
| listPolicies | `agentarts iam list-policies` |
| listAgencies | `agentarts iam list-agencies` |
| attachAgencyPolicy | `agentarts iam attach-agency-policy` |
| createAgencyWithPolicy | `agentarts iam create-agency-with-policy` |
| getOrganization | `agentarts swr get-organization` |
| createOrganization | `agentarts swr create-organization` |
| createOrGetOrganization | `agentarts swr create-or-get-organization` |
| getRepository | `agentarts swr get-repository` |
| createRepository | `agentarts swr create-repository` |
| createOrGetRepository | `agentarts swr create-or-get-repository` |
| createSwrSecret | `agentarts swr create-secret` |
| createAgent | `agentarts runtime create` |
| updateAgent | `agentarts runtime update` |
| createOrUpdateAgent | `agentarts runtime upsert` |
| getAgents | `agentarts runtime list` |
| findAgentByName | `agentarts runtime get` |
| findAgentById | `agentarts runtime get-by-id` |
| deleteAgentByName | `agentarts runtime delete` |
| createAgentEndpoint | `agentarts runtime create-endpoint` |
| updateAgentEndpoint | `agentarts runtime update-endpoint` |
| deleteAgentEndpoint | `agentarts runtime delete-endpoint` |
| findAgentEndpoint | `agentarts runtime get-endpoint` |
| pingAgent | `agentarts runtime ping` |

## Memory、Gateway 与 Runtime 数据面方法映射

| SDK 方法 | CLI |
| --- | --- |
| memory.createSpace | `agentarts memory create` |
| memory.getSpace | `agentarts memory get` |
| memory.listSpaces | `agentarts memory list` |
| memory.updateSpace | `agentarts memory update` |
| memory.deleteSpace | `agentarts memory delete` |
| memory.createMemorySession | `agentarts memory create-session` |
| memory.listSessions | `agentarts memory list-sessions` |
| memory.getSession | `agentarts memory get-session` |
| memory.deleteSession | `agentarts memory delete-session` |
| memory.addMessages | `agentarts memory add-messages` |
| memory.listMessages | `agentarts memory list-messages` |
| memory.getMessage | `agentarts memory get-message` |
| memory.getLastKMessages | `agentarts memory last-messages` |
| memory.searchMemories | `agentarts memory search-memories` |
| memory.listMemories | `agentarts memory list-memories` |
| memory.getMemory | `agentarts memory get-memory` |
| memory.createMemory | `agentarts memory create-memory` |
| memory.updateMemory | `agentarts memory update-memory` |
| memory.deleteMemory | `agentarts memory delete-memory` |
| gateway.createGateway | `agentarts gateway create` |
| gateway.getGateway | `agentarts gateway get` |
| gateway.listGateways | `agentarts gateway list` |
| gateway.updateGateway | `agentarts gateway update` |
| gateway.deleteGateway | `agentarts gateway delete` |
| gateway.createGatewayTarget | `agentarts gateway create-target` |
| gateway.getGatewayTarget | `agentarts gateway get-target` |
| gateway.listGatewayTargets | `agentarts gateway list-targets` |
| gateway.updateGatewayTarget | `agentarts gateway update-target` |
| gateway.deleteGatewayTarget | `agentarts gateway delete-target` |
| runtime.invokeAgent | `agentarts runtime invoke` |
| runtime.execCommand | `agentarts runtime exec-command` |
| runtime.uploadFiles | `agentarts runtime upload-files` |
| runtime.downloadFiles | `agentarts runtime download-files` |
| runtime.startSession | `agentarts runtime start-session` |
| runtime.stopSession | `agentarts runtime stop-session` |

LocalRuntimeClient.invokeAgent 由顶层 invoke --mode local 对应。运行时部署相关复合逻辑继续经过原 operations/runtime。

## 不单独生成云端命令的 SDK 表面

- RuntimeApp 注册入口、健康检查处理器、WebSocket/SSE、任务上下文：属于进程内服务框架，由 dev 和应用启动流程使用。
- requireApiKey/requireAccessToken/requireStsToken：函数包装器，CLI 对应的是其依赖的 Identity 获取凭据方法，不能以 JSON 传入任意业务函数。
- AsyncMemoryClient、MemorySession、AsyncMemorySession：同一组业务接口的异步/绑定会话包装，共享 memory 命令，不重复添加同义入口。
- LangGraph Saver/Store 与消息转换器：框架回调协议，由框架调用；底层 Memory 操作已具备 CLI。
- Browser.generateAutomationUrl/generateLiveViewUrl：依赖同一客户端中 startSession 缓存的流端点，属于连接信息辅助函数；start-session 输出已含 streams，后续自动化通过上述会话命令执行，不伪造或自动创建会话来恢复端点。
- SWR.getFullImageName/getAttrValue：本地格式化/属性工具；codeSession/browserSession 等是生命周期包装器。
- SDK 基础 HTTP、内层 Control/DataPlane、凭据链、签名、日志、重试、配置模型、setAuthToken、close：内部机制或客户端辅助操作，不重复注册 HTTP 透传或任意方法执行命令。
- 本次只补 SDK 已实现的方法；官方 API 中 SDK 本身未实现的接口不纳入 CLI 补齐范围。

## 验证

全表业务覆盖由 tests/unit/toolkit/cli/resources/test_sdk_cli_coverage.test.ts 检查：新增 SDK 方法而未映射会使测试失败。
参数路由、失败结果、会话恢复、清理、删除确认和文件输入输出由相邻 test_resource_commands.test.ts 验证。
测试使用模拟客户端，不会执行真实云端操作。

## 实现与兼容性约定

基于 feat/dev 的 c497ff7 复核全部业务客户端（8 组），保持 CLI → Operations → SDK 分层。
当前 131 个 SDK 云端业务方法都有命令入口，另有本地 ping 及 Memory 的 status/install/uninstall；上述 8 组共 135 个子命令。
方法覆盖不包含下文说明的进程内框架回调、基础传输与客户端辅助函数。

### 关键实现

- 最新 SDK 新增 createMemory/updateMemory；补充 `memory create-memory SPACE --request JSON` 与 `memory update-memory SPACE MEMORY --request JSON`，原样传入 SDK 接受的 OpenAPI snake_case 请求体，不把记录操作混入空间 CRUD。
- `memory create --custom-strategies JSON`、`memory update --name NAME --extract-enabled false` 补齐既有空间命令缺少的 SDK 选项。更新 SDK 不支持网络访问配置，因此移除原来会被静默忽略的 update --public/--private/--vpc-id/--subnet-id；创建仍支持。
- 空间参数校验失败和 SDK 返回失败后立即结束，设置非零退出码，不继续请求或打印成功。严格解析整数，不再把 1.5 或 12abc 截断成有效整数。
- 各新增资源命令验证必填字符串、JSON 对象/数组、数组元素、显式布尔值、有限数值；分页 limit/offset 要求安全整数并检查正数/非负数。SDK 自身的 UUID、名称、枚举等业务限制仍交给 SDK 校验。
- Identity 凭据获取的 --options 检查必需的 providerName/workloadAccessToken/agencySessionName/authFlow，Runtime 的类型化 options 检查已声明字段类型；任意 Record 字段继续按 SDK 开放对象传递。
- Memory 过滤器按 SDK 模型的 snake_case 字段转换并检查类型；未知键报错，避免 actorId 等错误拼写被静默丢弃。search-memories 不再强制 SDK 未要求的 --query，允许从 --filters.query 读取，显式 --query 优先。
- Gateway 失败返回非零退出码；分页拒绝 NaN/Infinity/小数；配置必须为对象、tags 必须为数组，空白 ID 在请求前拒绝。
- 资源查询返回 null 时保留 null，不再将“没有找到”渲染为 `{success:true}`。
- request-file 拒绝未知方法参数；本地 runtime ping 不再展示不生效的 --region 和 -k。
- 集成测试发现 RuntimeHTTPClient 与 BaseHTTPClient 重复拼接查询参数，造成签名和线上 URL 不一致；改为统一由 BaseHTTPClient 拼接一次。
- Identity 底层客户端省略未提供的可选查询参数，避免 Core 将 undefined 参与签名、传输层却发送空值而触发 401。两项传输修复均不改变 SDK 公共签名。

### 查询命令横向对照

以下形式不同，但都来自 SDK 的标识符要求；无需人为增加必填参数或自动创建会话。
Browser/Code Interpreter 及既有空间、网关以位置参数定位；Runtime/Identity/SWR 按各自接口的命名选项定位，均保留已有选项兼容性。

| 查询对象 | 最小调用（省略 pnpm cli） | SDK 方法与说明 |
| --- | --- | --- |
| Memory 空间 | `memory get SPACE_ID` | getSpace(spaceId) |
| Memory 会话 | `memory get-session SPACE_ID SESSION_ID` | getSession(spaceId, sessionId)，空间隔离必需 |
| Memory 消息 | `memory get-message SPACE_ID SESSION_ID MESSAGE_ID` | getMessage(messageId, spaceId, sessionId)，CLI 层负责重排 SDK 的参数顺序 |
| Memory 记录 | `memory get-memory SPACE_ID MEMORY_ID` | getMemory(spaceId, memoryId) |
| 网关 | `gateway get GATEWAY_ID` | getGateway(gatewayId) |
| 网关目标 | `gateway get-target GATEWAY_ID TARGET_ID` | getGatewayTarget(gatewayId, targetId) |
| Runtime 按 ID | `runtime get-by-id --agent-id ID` | findAgentById(agentId)，直接详情查询 |
| Runtime 按名称 | `runtime get --agent-name NAME` | findAgentByName(agentName)，精确名称搜索；未找到返回 null |
| Runtime Endpoint | `runtime get-endpoint --agent-id ID --endpoint-name NAME` | findAgentEndpoint(agentId, endpointName) |
| Identity 资源 | `identity get-workload-identity --name NAME` 等 | SDK 用 name 标识，而非 UUID；三种 credential-provider 同理 |
| Browser 资源/Profile | `browser get ID` / `browser get-profile PROFILE_ID` | getBrowser/getBrowserProfile；UUID 格式由 SDK 校验 |
| Code Interpreter 资源 | `code-interpreter get ID` | getCodeInterpreter(codeInterpreterId) |
| Browser 会话 | `browser get-session NAME SESSION_ID` | SDK getSession(apiKey?) 从客户端状态读取名称和 sessionId，Operations 恢复状态 |
| Code Interpreter 会话 | `code-interpreter get-session NAME SESSION_ID` | SDK getSession(name, sessionId?, apiKey?)；CLI 是新实例，必须显式指定 sessionId |
| SWR 组织/仓库 | `swr get-organization --organization NAME` / `swr get-repository --organization NAME --repository NAME` | SDK 使用组织名称和仓库名称，不存在通用 ID 查询 |
| IAM | 无详情 get 命令 | SDK 仅有 list/create/attach 等方法，不虚构 get 接口 |

Identity 的 get-resource-api-key/get-resource-oauth2-token/get-resource-sts-token 是凭据交换流程，并非普通资源详情查询，必须提供 SDK 的工作负载令牌等参数。

### 测试范围与限制

运行 `pnpm typecheck`、`pnpm build`、`pnpm test` 和 `pnpm test:integration`。
集成测试保留仓库默认门控（ALLOW_CREATE=0、RUN_BILLABLE=0）：本地及云端只读测试实际执行；生命周期创建/删除、计费沙箱、需要既有部署/专用凭据及人工 OAuth 的场景按测试条件跳过，不计为已验证。
新增回归测试直接读取 SDK 源码，核对方法覆盖、参数顺序、名称、必填性和基本类型，并验证最小 get 调用、失败退出码、JSON/分页边界及签名请求中的参数唯一性。

提交前最终验证记录：

| 检查 | 结果 |
| --- | --- |
| pnpm typecheck | 通过 |
| pnpm test | 65 个文件通过，2367 项通过、1 项跳过 |
| pnpm build | 两个 workspace 包构建通过 |
| pnpm test:integration（默认门控） | 49 项通过、56 项按条件跳过，0 项失败 |
| 构建产物命令注册 | memory 22、gateway 10、runtime 18、identity 18、browser 38、code-interpreter 17、iam 5、swr 7，未发现重名 |
| git diff --check | 通过 |

默认门控的 56 个跳过项并不代表通过。需要创建资源/启用计费、既有 Runtime 部署、沙箱或 OAuth 场景配置，才能继续验证对应路径；仓库中交互式 OAuth 测试本身标记为人工执行。


## 实体 ID 命令形式统一

```bash
pnpm cli browser get BROWSER_ID
pnpm cli browser update BROWSER_ID --observability '{"enabled":true}'
pnpm cli browser delete BROWSER_ID --force
pnpm cli browser get-profile PROFILE_ID
pnpm cli browser delete-profile PROFILE_ID --force
pnpm cli browser save-profile NAME SESSION_ID PROFILE_ID
pnpm cli code-interpreter get CODE_INTERPRETER_ID
pnpm cli code-interpreter update CODE_INTERPRETER_ID --tags '[{"key":"team","value":"dev"}]'
pnpm cli code-interpreter delete CODE_INTERPRETER_ID --force
```

实体 ID 必须显式提供。Usage 展示位置参数 <browserId>/<codeInterpreterId>/<profileId>；为兼容已有脚本，仍接受 --browser-id/--code-interpreter-id/--profile-id 或 --request-file 中对应的 SDK camelCase 字段。多种来源同时传入时必须相同，冲突在确认或 SDK 调用前报错；缺失、空白及非法类型同样拒绝。

名称、会话 ID 和其它会话操作的 SDK 契约保持原样，未将资源名称或会话状态误替换为控制面实体 ID。SDK 与 Operations 的签名保持不变。



## Code Interpreter 会话命令参数统一

以下命令使用解释器名称而非实体 UUID；名称和会话 ID 明确展示为必填位置参数：

```bash
pnpm cli code-interpreter start-session TOOL_NAME --session-name WORK_NAME
pnpm cli code-interpreter get-session TOOL_NAME SESSION_ID
pnpm cli code-interpreter stop-session TOOL_NAME SESSION_ID
pnpm cli code-interpreter invoke TOOL_NAME SESSION_ID --operate-type execute_code --arguments '{"code":"print(1)","language":"python"}'
pnpm cli code-interpreter execute-code TOOL_NAME SESSION_ID --code 'print(1)'
pnpm cli code-interpreter execute-code TOOL_NAME SESSION_ID --language typescript --code 'const total: number = 1 + 1; console.log(total);'
pnpm cli code-interpreter execute-command TOOL_NAME SESSION_ID --command 'pwd'
pnpm cli code-interpreter upload-file TOOL_NAME SESSION_ID --path /home/user/test.txt --content hello
pnpm cli code-interpreter upload-files TOOL_NAME SESSION_ID --files '[{"path":"/home/user/test.txt","content":"hello"}]'
pnpm cli code-interpreter download-file TOOL_NAME SESSION_ID --path /home/user/test.txt --output-file test.txt
pnpm cli code-interpreter download-files TOOL_NAME SESSION_ID --paths '["/home/user/test.txt"]'
pnpm cli code-interpreter install-packages TOOL_NAME SESSION_ID --packages '["requests"]'
pnpm cli code-interpreter clear-context TOOL_NAME SESSION_ID --force
```

旧 --code-interpreter-name/--session-id 形式继续兼容；此前会话命令的 --resource-name 作为解释器名称的旧别名保留。也可从 --request-file 传入 codeInterpreterName、sessionId（兼容旧 resourceName）。不同来源同时提供同一标识时必须一致，缺失、空白或冲突均在确认和 SDK 调用前拒绝。

SDK 方法的参数顺序保持不变。对于 execute-code 等依赖客户端状态的方法，CLI 单独解析名称及会话 ID 并传给 Operations 恢复上下文，不把这两个值塞进 SDK 的业务参数列表。Browser 会话命令不受此轮调整影响。



## Browser 全量命令参数统一

- 创建资源和 Profile 使用 <name>；列表操作不强制指定既有实体。
- get/update/delete 使用 <browserId>；get-profile/delete-profile 使用 <profileId>。
- start-session 使用 <browserName>，会话名称通过 --session-name 指定；创建时的 --session-id 按 SDK 保持可选。
- 所有后续会话与自动化操作使用 <browserName> <sessionId>，两者均必填，不能用控制面 UUID 代替浏览器名称。
- save-profile 使用 <browserName> <sessionId> <profileId>。保留旧组合 save-profile PROFILE_ID --resource-name NAME --session-id SESSION_ID；也保留 --profile-id 形式。
- switch-tab 额外要求 <tabId>；close-tab 的 [tabId] 可省略，沿用 SDK 关闭当前页的行为；new-tab 的 --url 按 SDK 保持可选。
- 新 --browser-name、原 --resource-name/--session-id、各实体 ID 命名选项及请求文件仍兼容；多来源定位参数冲突在确认及 SDK 调用前拒绝。

以上仅调整 CLI 的解析和帮助信息，Operations 与 SDK 的方法签名、字段顺序和会话状态恢复方式保持不变。

| Browser 命令 | 构建产物 Usage |
| --- | --- |
| create | `browser create [options] <name>` |
| list | `browser list [options]` |
| get | `browser get [options] <browserId>` |
| update | `browser update [options] <browserId>` |
| delete | `browser delete [options] <browserId>` |
| create-profile | `browser create-profile [options] <name>` |
| list-profiles | `browser list-profiles [options]` |
| get-profile | `browser get-profile [options] <profileId>` |
| delete-profile | `browser delete-profile [options] <profileId>` |
| start-session | `browser start-session [options] <browserName>` |
| stop-session | `browser stop-session [options] <browserName> <sessionId>` |
| get-session | `browser get-session [options] <browserName> <sessionId>` |
| save-profile | `browser save-profile [options] <browserName> <sessionId> <profileId>` |
| update-stream | `browser update-stream [options] <browserName> <sessionId>` |
| take-control | `browser take-control [options] <browserName> <sessionId>` |
| release-control | `browser release-control [options] <browserName> <sessionId>` |
| invoke | `browser invoke [options] <browserName> <sessionId>` |
| mouse-click | `browser mouse-click [options] <browserName> <sessionId>` |
| left-mouse-click | `browser left-mouse-click [options] <browserName> <sessionId>` |
| right-mouse-click | `browser right-mouse-click [options] <browserName> <sessionId>` |
| double-mouse-click | `browser double-mouse-click [options] <browserName> <sessionId>` |
| mouse-move | `browser mouse-move [options] <browserName> <sessionId>` |
| mouse-drag | `browser mouse-drag [options] <browserName> <sessionId>` |
| mouse-scroll | `browser mouse-scroll [options] <browserName> <sessionId>` |
| key-press | `browser key-press [options] <browserName> <sessionId>` |
| key-type | `browser key-type [options] <browserName> <sessionId>` |
| key-shortcut | `browser key-shortcut [options] <browserName> <sessionId>` |
| navigate | `browser navigate [options] <browserName> <sessionId>` |
| go-back | `browser go-back [options] <browserName> <sessionId>` |
| go-forward | `browser go-forward [options] <browserName> <sessionId>` |
| refresh | `browser refresh [options] <browserName> <sessionId>` |
| get-page-info | `browser get-page-info [options] <browserName> <sessionId>` |
| screenshot | `browser screenshot [options] <browserName> <sessionId>` |
| wait | `browser wait [options] <browserName> <sessionId>` |
| list-tabs | `browser list-tabs [options] <browserName> <sessionId>` |
| switch-tab | `browser switch-tab [options] <browserName> <sessionId> <tabId>` |
| close-tab | `browser close-tab [options] <browserName> <sessionId> [tabId]` |
| new-tab | `browser new-tab [options] <browserName> <sessionId>` |



## 基于 c497ff7 的提交前 Review

- 最新 SDK 的 TypeScript 支持沿用现有 --language 参数透传；真实 SDK 方法回归覆盖 python、typescript，并检查 javascript 在发送请求前被拒绝。
- Operations 保留程序调用者提供的 OAuth 回调和轮询器；不能通过 JSON 提供回调/轮询器的限制仅属于 CLI。
- 本地编辑器配置的忽略规则限定在仓库根目录，避免误忽略未来新增子工程的 tsconfig.json。
- 已复核实体 ID、数据面名称和会话 ID 的区分、命名选项/请求文件兼容性、实际模型序列化、输出文件权限、SDK 日志流、客户端清理以及包导出。
- 所有最终测试记录均区分实际通过和按门控跳过的用例；没有将生命周期、计费或人工 OAuth 路径计入通过数。


### c497ff7 最终验证结果

| 项目 | 结果 |
| --- | --- |
| 锁文件依赖同步 | pnpm install --frozen-lockfile 通过，未修改锁文件 |
| 类型检查 | pnpm typecheck 通过 |
| 单元测试 | 65 个文件通过，2367 项通过、1 项跳过 |
| 构建 | 两个 workspace 包构建通过 |
| 默认门控集成测试 | 9 个文件通过、10 个文件跳过；49 项通过、56 项跳过、0 项失败 |
| 包与导出 | pnpm pack 通过；所有明确导出目标及 CLI 入口存在；workspace 依赖已正确转换；根包语言常量和 11 个子路径实际导入通过 |
| CLI 注册 | 8 组共 135 个命令，无重名；公开业务方法覆盖检查通过 |
| Git 差异与忽略规则 | diff --check 通过；本地根目录编辑器配置仍忽略，子工程 tsconfig.json 不会被误忽略 |

此次 Review 已修复发现的 Operations OAuth 参数契约问题，补充了最新 SDK TypeScript 支持的 CLI 回归，并清理文档中的历史统计。默认验证范围内未发现剩余阻塞提交的问题；真实资源生命周期、计费会话及人工授权等 56 个跳过场景仍需单独配置后验证。

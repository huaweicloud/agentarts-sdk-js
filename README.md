# Huawei Cloud AgentArts SDK for Node.js

## Overview

华为云 AgentArts SDK 是用于开发、部署和管理 AI Agent 的综合工具包。它在支持主流 Agent 框架的同时，
与华为云服务（认证、镜像仓库、运行时、记忆等）无缝集成。

### Key Features

- **框架无关** - 兼容 LangChain、LangGraph、AutoGen、CrewAI 以及任意自定义 Agent 框架
- **一键部署** - 一条命令将 Agent 部署到华为云
- **内置工具** - Code Interpreter 沙箱、Memory 管理、Gateway（MCP 网关）支持
- **云端集成** - 与华为云认证、监控、日志无缝集成
- **CLI 工具链** - 完整的命令行工具，覆盖项目初始化、本地开发与云端部署

### Repository Structure

```
agentarts-sdk-js/
├── packages/
│   ├── agentarts-sdk/               # 主包（发布为 agentarts-sdk）
│   │   └── src/
│   │       ├── index.ts             # 公共导出（对应 Python agentarts/sdk/__init__.py）
│   │       ├── sdk/                 # 核心 SDK 模块
│   │       │   ├── runtime/         # HTTP/WebSocket 运行时（AgentArtsRuntimeApp）
│   │       │   ├── memory/          # 对话记忆管理
│   │       │   ├── tools/           # 内置工具（Code Interpreter、Browser）
│   │       │   ├── gateway/         # Gateway（MCP 网关）客户端
│   │       │   ├── identity/        # 认证与授权（OAuth2 / API Key / STS）
│   │       │   ├── integration/     # 框架适配（LangGraph 等）
│   │       │   └── service/         # 云服务 HTTP 客户端（IAM、SWR、Memory、Runtime…）
│   │       ├── toolkit/             # CLI 工具链实现
│   │       └── cli.ts               # CLI 入口（bin: agentarts）
│   └── huaweicloud-sdk-agentidentity/ # 对应 huaweicloudsdkagentidentity/v1（无 npm 版本，本地移植）
│
│   # 其余底座直接使用 npm 包，仓库内不再维护副本：
│   #   @huaweicloud/huaweicloud-sdk-core@3.1.222  （HcClient / ClientBuilder / 凭据 / 签名）
│   #   @huaweicloud/huaweicloud-sdk-iam@3.1.222   （IAM v5）
│   #   @huaweicloud/huaweicloud-sdk-swr@3.1.222   （SWR v2）
├── docs/
│   └── cn/                          # 中文文档
│       ├── sdk_user_guide/          # SDK 使用指南
│       └── toolkit_user_guide/      # CLI 使用指南
├── examples/                        # 示例项目（langgraph / basic）
├── tests/
│   ├── unit/                        # 单元测试（镜像 src/ 目录，与 Python tests/unit 1:1）
│   └── integration/                 # 集成测试（无云上凭据时默认跳过）
└── tools/                           # 构建/维护脚本
```

## Wrapping Your Agent as HTTP Server

SDK 提供 `AgentArtsRuntimeApp`，把 Agent 逻辑包装为标准 HTTP/WebSocket 服务，对外暴露：

- `POST /invocations` - Agent 调用入口
- `GET /ping` - 健康检查端点
- `WS /ws` - 流式双向通信端点

### Example: LangGraph Agent

```ts
// agent.ts
import { AgentArtsRuntimeApp, type RequestContext } from '@huaweicloud/agentarts-sdk';
import { Annotation, END, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

const app = new AgentArtsRuntimeApp();

const State = Annotation.Root({
  messages: Annotation<any[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  query: Annotation<string>(),
  response: Annotation<string>(),
});

class LangGraphAgent {
  private modelName = process.env.OPENAI_MODEL_NAME ?? 'gpt-4o-mini';
  private graph: any = null;

  private buildGraph() {
    const llm = new ChatOpenAI({
      model: this.modelName,
      apiKey: process.env.OPENAI_API_KEY,
      configuration: { baseURL: process.env.OPENAI_BASE_URL },
    });

    const processNode = async (state: typeof State.State) => {
      const query = state.query ?? '';
      const messages = state.messages?.length ? state.messages : [new HumanMessage(query)];
      const response = await llm.invoke(messages);
      return {
        messages: [new AIMessage(String(response.content))],
        response: String(response.content),
      };
    };

    return new StateGraph(State)
      .addNode('process', processNode)
      .addEdge('__start__', 'process')
      .addEdge('process', END)
      .compile();
  }

  async run(query: string) {
    const graph = this.graph ?? this.buildGraph();
    this.graph = graph;
    const result = await graph.invoke({ messages: [], query, response: '' });
    return { response: result.response ?? '' };
  }
}

const agent = new LangGraphAgent();

// 注册 Agent 入口（对应 Python 的 @app.entrypoint 装饰器）
app.entrypoint(async (payload: Record<string, any>, context?: RequestContext) => {
  const query = payload.message ?? '';
  return await agent.run(query);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  app.run();
}
```

### Key Points

1. **专注 Agent 逻辑** - 只需实现 Agent 逻辑，HTTP 服务、请求解析、响应格式化由 SDK 处理
2. **框架无关** - 可用于任何 Agent 框架（LangChain、LangGraph、AutoGen、CrewAI 或自定义实现）
3. **注册方式** - TypeScript 无装饰器语法，用 `app.entrypoint(handler)` 注册处理函数（对应 Python 的 `@app.entrypoint`）
4. **上下文支持** - 第二个参数命名为 `context` 时会注入 `RequestContext`，提供 sessionId、requestId 等请求元信息
5. **可配置模型** - 模型名可通过环境变量配置（如 `OPENAI_MODEL_NAME`）

## Installation

### Requirements

- Node.js 20 或更高版本
- pnpm（推荐）或 npm 包管理器

### Install via pnpm / npm

```bash
# pnpm（推荐）
pnpm add @huaweicloud/agentarts-sdk

# npm
npm install @huaweicloud/agentarts-sdk
```

### Install the CLI

`agentarts` 命令由 `agentarts-sdk` 包的 `bin` 提供，全局安装后即可直接使用：

```bash
# pnpm
pnpm add -g @huaweicloud/agentarts-sdk

# npm
npm install -g @huaweicloud/agentarts-sdk

agentarts --help
```

在仓库内开发时，也可以不全局安装，直接用本地构建产物：

```bash
pnpm build
node packages/agentarts-sdk/dist/cli.js --help
```

### Install from Source

```bash
# 克隆仓库
git clone https://github.com/huaweicloud/agentarts-sdk-js.git
cd agentarts-sdk-js

# 安装工作区依赖（pnpm workspace）
pnpm install

# 构建所有包
pnpm build
```

### Configure Huawei Cloud Credentials

设置华为云认证所需的环境变量：

**Windows (PowerShell):**

```powershell
$env:HUAWEICLOUD_SDK_AK = "your-access-key"
$env:HUAWEICLOUD_SDK_SK = "your-secret-key"
```

**Windows (Command Prompt):**

```cmd
set HUAWEICLOUD_SDK_AK=your-access-key
set HUAWEICLOUD_SDK_SK=your-secret-key
```

**Linux/macOS:**

```bash
export HUAWEICLOUD_SDK_AK="your-access-key"
export HUAWEICLOUD_SDK_SK="your-secret-key"
```

> **Note:** 请到 [华为云控制台](https://console.huaweicloud.com/) -> 我的凭证 -> 访问密钥 获取 AK/SK。

完整的环境变量说明见 [环境变量配置指南](docs/cn/sdk_user_guide/environment_variables.md)。

## Quick Start

### 1. Initialize a New Project

```bash
# 使用 LangGraph 模板创建新的 Agent 项目
agentarts init -n my_agent -t langgraph

# 可用模板：basic、langchain、langgraph
```

创建的目录结构：

```
my_agent/
├── agent.ts              # Agent 实现（TypeScript）
├── package.json          # 项目依赖
├── tsconfig.json         # TypeScript 编译配置
├── .agentarts_config.yaml # 项目配置
└── Dockerfile            # Docker 构建文件
```

### 2. Configure Environment

编辑 `.agentarts_config.yaml` 设置环境变量：

```yaml
runtime:
  environment_variables:
    - key: OPENAI_API_KEY
      value: "your-openai-api-key"
    - key: OPENAI_MODEL_NAME
      value: "gpt-4o-mini"  # 可选：gpt-4o、gpt-4-turbo 等
    - key: OPENAI_BASE_URL
      value: ""  # 可选：自定义 API 端点
```

### 3. Local Development

```bash
# 启动本地开发服务器
agentarts dev

# 服务运行在 http://127.0.0.1:8080
# 端点：
#   POST /invocations - 调用 Agent
#   GET  /ping        - 健康检查
```

### 4. Deploy to Huawei Cloud

```bash
# 配置区域
agentarts config set region cn-southwest-2

# 部署到云端
agentarts deploy

# 调用已部署的 Agent
agentarts invoke '{"message": "Hello, AgentArts!"}'

# 销毁部署
agentarts destroy
```

## CLI Commands Reference

| Command                 | Description                                    |
| ----------------------- | ---------------------------------------------- |
| `agentarts init`        | 初始化一个新的 Agent 项目                      |
| `agentarts dev`         | 启动本地开发服务器                             |
| `agentarts config`      | 配置 SDK 设置（别名：`configure`）             |
| `agentarts deploy`      | 部署 Agent 到华为云（别名：`launch`）          |
| `agentarts invoke`      | 调用已部署的 Agent                             |
| `agentarts destroy`     | 删除已部署的 Agent                             |
| `agentarts gateway`     | 管理网关                                       |
| `agentarts memory`      | 管理 Memory Space 与记忆插件                   |
| `agentarts runtime`     | 运行时资源、端点、会话、调用与文件操作 |
| `agentarts identity` | 工作负载身份、凭据提供商和资源令牌 |
| `agentarts browser` | 浏览器资源、Profile、会话与自动化 |
| `agentarts code-interpreter` | 代码沙箱资源、会话、代码执行与文件操作 |
| `agentarts iam` | IAM 委托和策略管理 |
| `agentarts swr` | 镜像组织、仓库和登录凭据 |

完整的 SDK 方法、Operations 和 CLI 逐项对照及参数用法见
[SDK 与 CLI 覆盖说明](docs/cn/toolkit_user_guide/sdk_cli_coverage.md)。

### Memory Commands

`agentarts memory` 提供空间管理、数据面操作和插件管理三组子命令。

**Space Management**（需要 AK/SK 认证）：

| Command                     | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `agentarts memory create`   | 创建 Memory Space                              |
| `agentarts memory get`      | 获取 Space 详情                                |
| `agentarts memory list`     | 列出 Space                                     |
| `agentarts memory update`   | 更新 Space                                     |
| `agentarts memory delete`   | 删除 Space                                     |
| `agentarts memory status`   | 检查 Space 状态与健康度                        |

**Session / Message / Memory Data Plane**（需要环境变量 `HUAWEICLOUD_SDK_MEMORY_API_KEY`）：

| Command | SDK Method | Description |
| --- | --- | --- |
| `agentarts memory create-session <spaceId>` | `createMemorySession` | 创建会话 |
| `agentarts memory list-sessions <spaceId>` | `listSessions` | 查询会话列表 |
| `agentarts memory get-session <spaceId> <sessionId>` | `getSession` | 查询会话详情 |
| `agentarts memory delete-session <spaceId> <sessionId>` | `deleteSession` | 删除会话 |
| `agentarts memory add-messages <spaceId> <sessionId>` | `addMessages` | 写入消息 |
| `agentarts memory list-messages <spaceId>` | `listMessages` | 查询消息列表，可指定 `--session-id` |
| `agentarts memory get-message <spaceId> <sessionId> <messageId>` | `getMessage` | 查询消息详情 |
| `agentarts memory last-messages <spaceId> <sessionId>` | `getLastKMessages` | 查询最近消息，支持 `--k` |
| `agentarts memory search-memories <spaceId>` | `searchMemories` | 语义搜索，可指定 `--query` 或 `--filters.query` |
| `agentarts memory list-memories <spaceId>` | `listMemories` | 查询记忆列表 |
| `agentarts memory get-memory <spaceId> <memoryId>` | `getMemory` | 查询记忆详情 |
| `agentarts memory create-memory <spaceId>` | `createMemory` | 直接创建记忆，使用 `--request JSON` |
| `agentarts memory update-memory <spaceId> <memoryId>` | `updateMemory` | 更新记忆，使用 `--request JSON` |
| `agentarts memory delete-memory <spaceId> <memoryId>` | `deleteMemory` | 删除记忆 |

数据面命令默认输出 JSON，支持 `-r/--region`、`-k/--skip-ssl-verification` 和
`-o json`；区域默认从 SDK 环境变量读取。列表支持 `--limit`、`--offset`。
删除前会确认，脚本中可显式使用 `--force`。控制面的 AK/SK 不能代替数据面 API Key。

空间和数据面命令均采用 `CLI → toolkit/operations/memory → SDK` 分层：CLI 解析参数、
确认操作并显示结果；操作层封装 SDK 调用与结果，数据面操作还统一管理连接清理。

```bash
# 在仓库根目录运行，先执行 pnpm build。
pnpm cli memory create-session SPACE_ID --actor-id user-001
pnpm cli memory add-messages SPACE_ID SESSION_ID \
  --messages '[{"role":"user","content":"我喜欢步行"}]'
pnpm cli memory last-messages SPACE_ID SESSION_ID --k 10
pnpm cli memory search-memories SPACE_ID --query '出行偏好' \
  --filters '{"actor_id":"user-001","top_k":3}'
```

`--messages` 使用 SDK 消息字段：文本为 `role/content`，工具调用为
`type: "tool_call"` 加 `id/name/arguments`，工具结果为 `type: "tool_result"`
加 `toolCallId/content`。支持 `--timestamp`、`--idempotency-key`、`--force-extract`。
`search-memories` 和 `list-memories` 的 `--filters` 使用 API 的 snake_case 字段，
例如 `actor_id`、`session_id`、`strategy_type`；完整参数见各命令 `--help`。

**Plugin Installation & Local Server:**

| Command                          | Description                                                           |
| -------------------------------- | --------------------------------------------------------------------- |
| `agentarts memory install`       | 将记忆插件安装到 AI Agent（claude、codex、opencode、hermes）          |
| `agentarts memory uninstall`     | 从 AI Agent 卸载记忆插件                                              |

> 记忆插件的本地 MCP Server 依赖可选包 `@modelcontextprotocol/sdk`（已列入 `optionalDependencies`），
> 使用 `agentarts memory install` 前请确保该依赖已安装。

## Limitations & Requirements

### Node.js Version

- **Minimum:** Node.js 20（SDK 使用全局 `fetch`、`AbortSignal.timeout` 等能力）
- **Recommended:** Node.js 20 LTS 或 22 LTS

### Framework Versions

使用可选框架依赖时，请确保满足以下最低版本：

| Framework              | Minimum Version | Install Command                     |
| ---------------------- | --------------- | ----------------------------------- |
| @langchain/langgraph   | 1.0.0           | `pnpm add @langchain/langgraph`     |
| @langchain/core        | 1.0.0           | `pnpm add @langchain/core`          |

> **Note:** `@langchain/core` 与 `@langchain/langgraph` 是 `agentarts-sdk` 的可选 peer 依赖
> （`peerDependenciesMeta.optional = true`）。LangGraph 1.0+ 引入了新的 Checkpoint 格式，
> 包含必需字段（`step`、`pending_sends`、`parents`），SDK 的集成模块兼容 LangGraph 1.0 及以上版本。

### Docker

以下场景需要 Docker：

- 通过 `agentarts deploy`（别名 `launch`）构建并部署 Agent

**安装 Docker：**

- [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop)
- [Docker Engine for Linux](https://docs.docker.com/engine/install/)

### 与 Python 版的差异

以下 Python 版能力**不在 Node.js 版中移植**：

- **Google ADK 集成**（`agentarts.sdk.integration.google_adk`）与 `google-adk` 项目模板不提供；
  需要 Gemini 时可自行封装后在 `app.entrypoint` 中调用。
- **Java Agent 支持**：CLI 的 `init` / `dev` / `deploy` 不提供 Java 模板与 `dev_java` 相关能力，
  仅支持 Node.js / TypeScript Agent。

其余 CLI 命令、参数、配置文件结构（`.agentarts_config.yaml`）与行为与 Python 版保持一致。

### Resource Quotas

资源配额与限制请参见 [华为云 AgentArts 文档](https://docs.huaweicloud.com/agentarts)。

## Documentation

- [SDK 使用指南](docs/cn/sdk_user_guide/) - Runtime、Memory、Code Interpreter、Gateway、Agent Identity
- [CLI 使用指南](docs/cn/toolkit_user_guide/) - init、config、deploy、invoke、destroy、dev、runtime、gateway
- [移植约定](PORTING.md) - Python → TypeScript 的命名/目录/行为约定

## Development

```bash
# 安装工作区依赖
pnpm install

# 构建所有包（tsc，产物在各自 dist/）
pnpm build

# 运行单元测试（vitest）
pnpm test

# 仅运行集成测试（需要云上凭据，默认跳过）
pnpm test:integration

# 类型检查（不产出文件）
pnpm typecheck

# 格式化
pnpm format

# 发布（维护者）：推送 vX.Y.Z tag 触发 .github/workflows/publish-npm.yml
```

## License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## Contributing

查看 [CONTRIBUTING.md](CONTRIBUTING.md)


## Support

- **Issues:** [GitHub Issues](https://github.com/huaweicloud/agentarts-sdk-js/issues)
- **Documentation:** <https://support.huaweicloud.com/productdesc-agentarts/agentarts_03_0002.html>
- **Email:** <hwagentartssdk@huawei.com>

# AgentArts SDK 示例（TypeScript）

本目录是 `agentarts-sdk-python` 的 `examples/` 的 TypeScript 移植，全部使用最终 Node.js API 形态：

```ts
import { AgentArtsRuntimeApp, type RequestContext } from 'agentarts-sdk';

const app = new AgentArtsRuntimeApp();

const handler = app.entrypoint(async (payload: Record<string, any>, context?: RequestContext) => {
  return { response: `You said: ${payload?.message ?? ''}` };
});

handler.run('0.0.0.0', 8080);
```

> 只依赖 `packages/agentarts-sdk`（SDK 源码未做任何改动）。示例自身是独立的 npm 项目，各自带
> `package.json` / `tsconfig.json` / `README.md` / 源码。

## 目录与 Python 示例对照

| TypeScript 示例 | Python 源文件 | 说明 |
| --- | --- | --- |
| [basic_agent](basic_agent/agent.ts) | `examples/basic_agent/agent.py` | 最小 Agent：回显 `message` |
| [agent_tools](agent_tools/integrate-tools.ts) | `examples/agent_tools/integrate_tools.py` | LangGraph 工具调用 + Code Interpreter 沙箱执行 Python 代码 |
| [memory_agent](memory_agent/agent.ts) | `examples/memory_usage/agent_with_memory.py` | Memory Service 会话/消息读写 |
| [langgraph_agent](langgraph_agent/agent.ts) | `examples/integration/langgraph/langgraph_agent.py` | LangGraph + `AgentArtsMemorySessionSaver` 持久化状态 |
| [langchain_agent](langchain_agent/agent.ts) | `examples/integration/langchain/langchain_agent.py` | LangChain 工具调用循环（`calculate` / `get_current_time` / `word_count`） |

未移植的 Python 示例及原因见下文「未移植示例」。

## 前置条件

- Node.js 20 或更高版本
- pnpm（推荐）或 npm
- 本地开发：无额外要求
- 云端部署：Docker（`agentarts deploy` 需要构建镜像）与华为云 AK/SK

## 安装依赖

每个示例的 `package.json` 都把 SDK 声明为 monorepo 依赖：

```json
{
  "dependencies": {
    "agentarts-sdk": "workspace:*"
  }
}
```

本仓库遵循 [PORTING.md](../PORTING.md) 的约定，**没有**修改根配置（`pnpm-workspace.yaml` 目前只包含
`packages/*`），因此在本仓库内使用示例时有三种方式：

```bash
# 方式 A（推荐，monorepo 联动）：在根 pnpm-workspace.yaml 的 packages 下增加一行后重新安装
#   - 'packages/*'
#   - 'examples/*'
pnpm install
pnpm build

# 方式 B（不改根配置）：把示例里的依赖换成指向本地包的 file: 协议
#   "agentarts-sdk": "file:../../packages/agentarts-sdk"
cd examples/basic_agent
pnpm install
# 注意：file: 依赖读取打包产物，因此仍需先在仓库根执行 pnpm build

# 方式 C：使用已发布版本（版本号与 packages/agentarts-sdk/package.json 一致）
cd examples/basic_agent
pnpm add agentarts-sdk@^0.1.11
```

> `@langchain/langgraph` / `@langchain/core` 已在本仓库根 `devDependencies` 中；`@langchain/openai`
> 未安装，`langgraph_agent`、`agent_tools`、`langchain_agent` 的 `package.json` 已声明该依赖，
> 运行前需要 `pnpm add @langchain/openai`（示例代码用动态 `import()` 加载，见下文「为什么动态 import」）。

## 运行示例

### 1. 直接用 tsx 运行（推荐，开发）

```bash
cd examples/basic_agent

# 运行前需已安装依赖（agentarts-sdk 必须能被解析）
pnpm start                  # 等价于 tsx agent.ts
pnpm exec tsx agent.ts      # 或直接调用本地 tsx
```

服务默认监听 `http://0.0.0.0:8080`（示例显式调用 `handler.run('0.0.0.0', 8080)`；
通过 `agentarts dev` 启动时可用 `-p/--port` 覆盖）：

```bash
curl http://127.0.0.1:8080/ping
curl -X POST http://127.0.0.1:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, Agent!"}'
```

### 2. 编译后运行（node）

示例的 `tsconfig.json` 是**类型检查配置**（`noEmit: true`），不产出 JS；需要产出时用一次性命令：

```bash
cd examples/basic_agent

# 需先安装依赖（agentarts-sdk 运行时要从 node_modules 解析）
pnpm exec tsc agent.ts --outDir dist \
  --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck

node dist/agent.js
```

> 也可以给 `tsc` 传入自己的 `tsconfig.build.json`（`noEmit: false` + `outDir`），本目录示例不预置。

### 3. 本地开发服务器（`agentarts dev`）

`agentarts dev` 从 `.agentarts_config.yaml` 读取入口（`agents.<name>.base.entrypoint`，`module:export` 形式），
并把 `runtime.environment_variables` 注入进程环境：

```yaml
# .agentarts_config.yaml（字段与 agentarts init 生成的一致；可手写）
agents:
  my_agent:
    base:
      entrypoint: agent:app          # 形式为 module:export；agent_tools 示例为 integrate-tools:app
      language: nodejs
    runtime:
      environment_variables:
        - key: OPENAI_API_KEY
          value: "sk-xxx"
        - key: OPENAI_MODEL_NAME
          value: "gpt-4o-mini"
```

TypeScript 入口需要由 `tsx` 之类的加载器启动 CLI（Node 不能直接 import `.ts`）：

```bash
cd examples/basic_agent

# 已安装依赖时，agentarts 在 node_modules/.bin 中
npx tsx ./node_modules/agentarts-sdk/dist/cli.js dev -p 8080

# 未安装依赖时，用根仓库构建产物
npx tsx ../../packages/agentarts-sdk/dist/cli.js dev -c .agentarts_config.yaml -p 8080
```

`dev` 常用参数：`-p/--port`、`-h/--host`、`-c/--config`、`-e/--env KEY=VALUE`、`--reload`
（Node 版不支持进程内热重载，`--reload` 需配合 `tsx watch` / `node --watch`）。

### 4. 云端部署（`agentarts deploy`）

```bash
# 配置区域（写入 .agentarts_config.yaml）
agentarts config set region cn-southwest-2

# 构建镜像并部署（别名：launch）
agentarts deploy

# 本地 Docker 运行
agentarts deploy --mode local --local-port 8080

# 调用 / 销毁
agentarts invoke '{"message": "Hello, AgentArts!"}'
agentarts destroy
```

云端部署需要：Docker、AK/SK（`HUAWEICLOUD_SDK_AK` / `HUAWEICLOUD_SDK_SK`）、SWR 组织与仓库配置，
并且**当前目录下需要存在 `Dockerfile`**（`agentarts deploy` 不生成镜像内容）。

> ⚠️ Toolkits 现状：`agentarts config` / `agentarts init` 目前按 **Python 项目** 生成 Dockerfile
> （`python:3.10-slim` + `pip install -r requirements.txt` + `CMD ["python", "-m", "..."]`）。
> TypeScript 示例需要自行提供 Node 版 Dockerfile，例如（basic_agent）：
>
> ```dockerfile
> FROM node:20-slim
> WORKDIR /app
> ENV DOCKER_CONTAINER=true
> COPY . .
> RUN npm install && npm install -D tsx
> EXPOSE 8080
> CMD ["npx", "tsx", "agent.ts"]
> ```
>
> 注意：`"agentarts-sdk": "workspace:*"` 在镜像里无法安装，构建前请把依赖改成已发布版本
> （`^0.1.11`）或 `file:` 指向已构建的本地包；`agentarts dev` 不受此限制。

## 环境变量总览

| 变量名 | 使用示例 | 说明 |
| --- | --- | --- |
| `OPENAI_API_KEY` | langgraph_agent、langchain_agent | OpenAI 兼容模型 API Key（必填） |
| `OPENAI_MODEL_NAME` | 所有调用模型的示例 | 模型名，默认 `gpt-4o-mini`（agent_tools 默认 `DeepSeek-V3`） |
| `OPENAI_BASE_URL` | 所有调用模型的示例 | 自定义 API Base URL（可选） |
| `MODEL_API_KEY` / `BASE_URL` | agent_tools | Python 示例使用的模型凭据变量名，仍优先读取 |
| `HUAWEICLOUD_SDK_MEMORY_API_KEY` | memory_agent、langgraph_agent | Memory Service 数据面 API Key |
| `HUAWEICLOUD_SDK_REGION` | memory_agent、langgraph_agent、agent_tools | 华为云区域 |
| `AGENTARTS_MEMORY_SPACE_ID` | memory_agent、langgraph_agent | Memory Space ID |
| `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY` | agent_tools | Code Interpreter API Key |
| `AGENTARTS_CODE_INTERPRETER_NAME` | agent_tools | Code Interpreter 名称（新增，默认占位符） |
| `HUAWEICLOUD_SDK_AK` / `HUAWEICLOUD_SDK_SK` | CLI 命令 | 华为云访问密钥 |

> `agent_tools` 额外支持目录下的 `.env`（`.env.example` 为模板）：Node 与 `tsx` 不会自动
> 读取该文件，示例通过零依赖的 `load-env.ts` 加载；真实进程环境变量优先，空值行会被跳过。
> 详见 [agent_tools/README.md](agent_tools/README.md#使用-env-文件本地开发推荐)。

## 类型检查

`tsconfig.json` 通过 `paths` 把 `agentarts-sdk` 以及示例用到的子路径
（`agentarts-sdk/sdk/memory`、`agentarts-sdk/sdk/integration/langgraph`）映射到
`../../packages/agentarts-sdk/src`，因此**无需安装依赖**就能在仓库根完成类型检查（`noEmit`）：

```bash
pnpm exec tsc -p examples/basic_agent/tsconfig.json
pnpm exec tsc -p examples/agent_tools/tsconfig.json
pnpm exec tsc -p examples/memory_agent/tsconfig.json
pnpm exec tsc -p examples/langgraph_agent/tsconfig.json
pnpm exec tsc -p examples/langchain_agent/tsconfig.json
```

五个示例均通过（`--strict`、`module`/`moduleResolution` = `NodeNext`、`target` = `ES2022`）。
注意：直接对单文件执行 `tsc --noEmit ... agent.ts` 时，命令行参数无法携带 `paths`，裸包
`agentarts-sdk` 需要已安装才能解析，因此仓库内请使用上面的 `-p <示例>/tsconfig.json`。

## 为什么动态 import `@langchain/openai`

`@langchain/openai` 是可选依赖（本仓库未安装）。为了同时满足「示例可读」和「不安装依赖也能通过类型检查」，
示例把它声明在 `package.json` 中，并在代码里用**类型无关的动态 import** 加载：

```ts
const packageName: string = '@langchain/openai'; // 显式 string 类型，避免 TS 静态解析该模块
const { ChatOpenAI } = await import(packageName) as any;
```

这样类型检查不依赖安装；运行时会给出明确错误提示（`pnpm add @langchain/openai`）。
`@langchain/langgraph` / `@langchain/core` 是示例的显式依赖，按正常方式静态 import。

## 未移植示例

| Python 示例 | 原因 |
| --- | --- |
| `examples/integration/google_adk/google_adk_agent.py` | Google ADK 集成未移植到 Node.js 版（`agentarts.sdk.integration.google_adk` 不存在，README「与 Python 版的差异」已说明） |
| `examples/finance_adk/` | 依赖 Google ADK（`google.adk.agents.LlmAgent`、ADK Session/Memory Service）+ Python 专用交互脚本，Node.js 版没有对应集成 |
| `examples/navigation_langgraph_memory/` | 依赖 Python TUI（`tui_app.py` / `tui_encoding.py`，rich/textual 风格交互）与 `amap_tools.py` 的 Python 侧封装；其核心能力（LangGraph + Memory）已由 `langgraph_agent` 示例覆盖 |

`examples/agent_identity/` 在 Python 侧是 Jupyter notebook 示例，本次迁移范围未包含；Identity 用法见
`docs/cn/sdk_user_guide/agent_identity_guide.md`。

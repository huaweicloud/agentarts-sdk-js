# 使用华为云 AgentArts 代码解释器并集成到 Agent（TypeScript）

对应 Python `examples/agent_tools/integrate_tools.py`。

演示基于 AgentArts 代码解释器（Code Interpreter）开发一个「Python / TypeScript 代码执行」工具，
并把工具集成到 LangGraph Agent 中，整体流程：

1. 创建一个沙箱（sandbox）会话（`withCodeSession` 管理会话的启动与停止）；
2. 配置基于 LangGraph 的 Agent，由模型生成代码；
3. 在沙箱中执行代码（`client.invoke('execute_code', ...)`，`language` 取 `python` 或 `typescript`）；
4. Agent 获取执行结果并返回给用户。

> 服务端支持的语言：`python`、`typescript`。`javascript` 会被拒绝
> （`Unsupported language: javascript. Supported: python, typescript`）。

## 前置条件

- 拥有华为云 AgentArts Tools 的访问权限，并已创建 Code Interpreter 资源
- 拥有模型访问权限
- 已安装 `agentarts-sdk`、`@langchain/langgraph`、`@langchain/core`、`@langchain/openai`

```bash
pnpm install
pnpm add @langchain/openai     # 本仓库未预装 @langchain/openai
```

## 环境变量

| 变量名 | 说明 | 必需 |
| --- | --- | --- |
| `MODEL_API_KEY` | 模型 API Key（Python 示例变量名） | 是（或用 `OPENAI_API_KEY`） |
| `BASE_URL` | 模型 API Base URL（Python 示例变量名） | 否（或用 `OPENAI_BASE_URL`） |
| `OPENAI_MODEL_NAME` | 模型名，默认 `DeepSeek-V3` | 否 |
| `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY` | Code Interpreter API Key | 是 |
| `HUAWEICLOUD_SDK_REGION` | Code Interpreter 所在区域；未设置时走SDK默认区域 | 是 |
| `AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT` | Code Interpreter 数据面端点；SDK **不会**按 region 自动推导，缺失时请求 URL 会退化成相对路径并报 `Failed to parse URL` | 是 |
| `AGENTARTS_CODE_INTERPRETER_NAME` | Code Interpreter 名称，默认占位符 `your_code_interpreter_name` | 是 |

> 代码中的 `your_code_interpreter_name` 沿用 Python 示例的占位符，
> 请通过上面两个环境变量传入真实值。

### 使用 `.env` 文件（本地开发推荐）

Node.js 与 `tsx` 都**不会**自动读取 `.env`。本示例内置了零依赖加载器 `load-env.ts`，
并在 `integrate-tools.ts` 中作为第一条 import 引入，启动时读取同目录的 `.env`：

```bash
cd examples/agent_tools
cp .env.example .env     # 然后填入真实值
pnpm start               # 启动首行会打印 [load-env] loaded N variable(s) ...
```

规则：

- `.env` 已被根 `.gitignore` 忽略；`.env.example` 会提交，作为变量清单模板。
- 优先顺序为 **真实进程环境变量 > `.env`**（加载器只填充未定义的键），
  因此 shell `export` 与 `agentarts dev -e KEY=VALUE` 始终优先。
- 空值行（如 `MODEL_API_KEY=`）会被跳过，便于沿用代码默认值或 `OPENAI_*` 回退变量。
- `pnpm start` / `agentarts dev` 都生效（二者加载的是同一个入口模块）。
- 云端部署时镜像里没有 `.env` 语义，仍应使用 `.agentarts_config.yaml` 的
  `runtime.environment_variables` 或平台侧环境变量。

## 运行

```bash
pnpm start                 # tsx integrate-tools.ts
# 或：pnpm exec tsx integrate-tools.ts
```

接口为 `POST /invocations`，支持两种请求体。

### 方式一：直通沙箱（`code`，不经过模型）

把代码直接送进沙箱执行，适合单独验证 Code Interpreter，不消耗 token。默认按 Python 执行：

```bash
curl -X POST http://127.0.0.1:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"code": "import sys\nprint(sys.version)"}'
```

加 `language` 字段可执行 TypeScript（沙箱原生支持，无需预装 `tsc` / `tsx`）：

```bash
curl -X POST http://127.0.0.1:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"code": "const n: number = 41;\nconsole.log(n + 1);", "language": "typescript"}'
```

响应为 `{"code": "...", "language": "python", "result": {...}}`，`result` 是沙箱返回的原始结果
（结构化内容，含 `content` 数组，与 SDK `execute_code` 的返回值一致）。

此模式只需要 `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY`、`HUAWEICLOUD_SDK_REGION`、
`AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT`、`AGENTARTS_CODE_INTERPRETER_NAME` 四个变量，
`MODEL_API_KEY` 可以不配。

### 方式二：Agent 对话（`message`，模型决定是否调用工具）

```bash
# Python（默认）
curl -X POST http://127.0.0.1:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"message": "必须使用 execute_code_tool 执行 Python 代码：计算 1 到 100 之间最大的质数"}'

# TypeScript
curl -X POST http://127.0.0.1:8080/invocations \
  -H "Content-Type: application/json" \
  -d '{"message": "用 TypeScript 写一段代码计算 1 到 100 之间最大的质数并打印，必须调用 execute_code_tool"}'
```

`message`（或 `query`）会走 LangGraph 的工具调用循环，响应为助手的最终文本。
不传时使用默认问题「告诉我1到100之间最大的质数」。

> 系统提示词写明「简单问题直接回答」，所以普通提问可能不进沙箱；
> 需要显式要求「用 Python / TypeScript 执行」或「必须调用 execute_code_tool」才会稳定触发。

## 代码要点

```ts
// 沙箱执行：工具（模型驱动）与直通模式共用
export async function runCodeInSandbox(code, language = 'python', description = '') {
  const response = await withCodeSession(
    region,
    interpreterName,
    (client) =>
      client.invoke(
        'execute_code',
        { code, language, clear_context: false },
        apiKey,
      ),
    'API_KEY',
    apiKey,
  );
  return response['result'];
}

// 工具定义：@langchain/core 的 tool() + JSON Schema（无需 zod）
export const executeCodeTool = tool(
  async (input) => JSON.stringify(await runCodeInSandbox(input.code, input.language ?? 'python', input.description)),
  {
    name: 'execute_code_tool',
    description: 'Execute Python or TypeScript code in the sandbox',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        language: { type: 'string', enum: ['python', 'typescript'], default: 'python' },
        description: { type: 'string' },
      },
      required: ['code'],
    },
  },
);

// Agent 图：agent -> (有 tool_calls?) -> tools -> agent -> ... -> END
const workflow = new StateGraph(AgentState)
  .addNode('agent', callModel)
  .addNode('tools', new ToolNode(tools))
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, { tools: 'tools', [END]: END })
  .addEdge('tools', 'agent');
```

## 类型检查

```bash
pnpm exec tsc -p tsconfig.json
```

## 与 Python 示例的差异

| 项 | Python | TypeScript |
| --- | --- | --- |
| 工具定义 | `@tool` 装饰器 + 类型注解 | `tool(fn, { name, description, schema })`，schema 用 JSON Schema |
| 沙箱会话 | `with code_session(...) as client:` | `withCodeSession(region, name, callback, authType, apiKey)`（回调式，等价于 `with`） |
| 调用方式 | `code_client.invoke(operate_type=..., api_key=..., arguments=...)` | `client.invoke('execute_code', args, apiKey)`（位置参数，camelCase 命名） |
| `print` | `print(f"\n Generated Code: {code}")` | `console.log(...)`（示例输出，非 SDK 内部日志） |
| 入口 query | 硬编码问题，忽略 payload | `payload.message` / `payload.query` 可覆盖，默认仍是同一个问题 |
| 支持语言 | 仅 Python | Python + TypeScript（`language` 参数，`javascript` 不被服务端接受） |
| 工具名 | `execute_python_tool` | `execute_code_tool`（多了 `language` 字段） |
| 直通沙箱 | 无 | 额外支持 `{"code": "...", "language": "typescript"}`，跳过模型直接执行（新增能力，便于测试沙箱） |
| 模型凭据 | 只读 `MODEL_API_KEY` / `BASE_URL` | 优先这两个变量，回退 `OPENAI_API_KEY` / `OPENAI_BASE_URL` |
| Code Interpreter 区域/名称 | 硬编码 `"your_region"` / `"your_code_interpreter_name"` | 区域未设置时走 SDK 默认值，同时两者均可用 `HUAWEICLOUD_SDK_REGION` / `AGENTARTS_CODE_INTERPRETER_NAME` 覆盖 |

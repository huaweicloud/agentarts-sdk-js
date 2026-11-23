/**
 * Agent Tools Example - Code Interpreter integrated into a LangGraph agent.
 *
 * TypeScript port of `examples/agent_tools/integrate_tools.py`.
 *
 * The agent is a small LangGraph tool-calling loop:
 *
 *   agent  -> (tool calls?) -> tools -> agent -> ... -> END
 *
 * The single tool, `execute_code_tool`, runs Python or TypeScript code in the
 * AgentArts Code Interpreter sandbox through the SDK's `withCodeSession` helper
 * (the Node.js counterpart of Python's `with code_session(...) as client:`).
 *
 * The sandbox natively executes `python` and `typescript`; `javascript` is
 * rejected by the service (`Unsupported language: javascript`).
 *
 * Required environment variables:
 * - `MODEL_API_KEY` / `BASE_URL`: model credentials (Python names);
 *   `OPENAI_API_KEY` / `OPENAI_BASE_URL` are accepted as fallbacks
 * - `OPENAI_MODEL_NAME`: model name (default: `DeepSeek-V3`)
 * - `HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY`: Code Interpreter API Key
 * - `HUAWEICLOUD_SDK_REGION`: region of the Code Interpreter
 *   (falls back to the SDK default region when unset)
 * - `AGENTARTS_CODE_INTERPRETER_NAME`: Code Interpreter name
 *   (default: `your_code_interpreter_name`)
 *
 * Run:
 *   npx tsx integrate-tools.ts
 *
 * Credentials can also live in `./.env` (see `.env.example`); real process
 * environment variables take precedence over that file.
 */

// Side-effect import: must stay first so `.env` is applied before any other
// module (or the SDK) starts reading `process.env`.
import './load-env.js';

import { pathToFileURL } from 'node:url';

import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ToolNode } from '@langchain/langgraph/prebuilt';

import {
  AgentArtsRuntimeApp,
  SUPPORTED_CODE_LANGUAGES,
  withCodeSession,
  type RequestContext,
} from 'agentarts-sdk';

/** System prompt (kept aligned with the Python example, plus TypeScript). */
export const SYSTEM_PROMPT = `你是一个AI助手，可以使用Python或TypeScript代码执行工具来解决问题。

可用工具：
- execute_code_tool(code: str, language: str, description: str): 执行代码
  - language 只能是 "python"（默认）或 "typescript"
  - 沙箱原生支持 TypeScript，不需要先转译；不支持 "javascript"

使用原则：
1. 仅在需要精确计算或复杂逻辑时使用工具
2. 简单问题直接回答，无需工具验证
3. 默认用 Python；用户明确要求 TypeScript 时传 language="typescript"
4. 工具调用最多1-2次，避免重复验证
5. 获得结果后立即返回答案
`;

/** Runtime application hosting the AgentArts HTTP endpoints. */
export const app = new AgentArtsRuntimeApp();

/** Comment prefix used when prepending a description to the code. */
const COMMENT_PREFIX: Record<string, string> = {
  python: '#',
  typescript: '//',
};

/**
 * Run code in the sandbox and return the raw `result` payload.
 *
 * Shared by the LangGraph tool (model-driven path) and the `code` shortcut in
 * {@link handler} (direct path), so both use exactly the same configuration.
 *
 * Python:
 *   with code_session(region, name, api_key=api_key) as code_client:
 *       response = code_client.invoke("execute_code", api_key=api_key, arguments={...})
 *
 * @param code Source code to execute.
 * @param language `"python"` (default) or `"typescript"`; see
 *   `SUPPORTED_CODE_LANGUAGES`.
 * @param description Optional comment prepended to the code.
 */
export async function runCodeInSandbox(
  code: string,
  language = 'python',
  description = '',
): Promise<any> {
  let source = code;

  if (description) {
    source = `${COMMENT_PREFIX[language] ?? '#'} ${description}\n${source}`;
  }

  console.log(`\n Generated ${language} Code: ${source}`);

  // Configure HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY to avoid passing the
  // key explicitly (the SDK also reads it from the environment).
  const apiKey = process.env.HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY ?? '';
  const region = process.env.HUAWEICLOUD_SDK_REGION ?? '';
  const interpreterName =
    process.env.AGENTARTS_CODE_INTERPRETER_NAME ?? 'your_code_interpreter_name';

  const response = await withCodeSession(
    region,
    interpreterName,
    (client) => {
      return client.invoke(
        'execute_code',
        {
          code: source,
          language,
          clear_context: false,
        },
        apiKey,
      )
    },
    'API_KEY',
    apiKey,
  );

  return response['result'];
}

/** Throw a clear error for languages the sandbox does not support. */
export function assertSupportedLanguage(language: string): string {
  if (!SUPPORTED_CODE_LANGUAGES.includes(language as any)) {
    throw new Error(
      `Unsupported language: ${language}. Supported: ${SUPPORTED_CODE_LANGUAGES.join(', ')}`,
    );
  }
  return language;
}

/**
 * Execute Python or TypeScript code in the AgentArts Code Interpreter sandbox.
 *
 * Python used `@tool` on a plain function; the JS SDK uses `tool(fn, {...})`
 * with a JSON Schema so no extra schema library (zod) is required.
 */
export const executeCodeTool = tool(
  async (input: Record<string, any>) =>
    // Python: `json.dumps(response["result"])`.
    JSON.stringify(
      await runCodeInSandbox(
        String(input?.code ?? ''),
        assertSupportedLanguage(String(input?.language ?? 'python')),
        String(input?.description ?? ''),
      ),
    ),
  {
    name: 'execute_code_tool',
    description: 'Execute Python or TypeScript code in the sandbox',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Source code to execute' },
        language: {
          type: 'string',
          description: 'Programming language of the code',
          enum: [...SUPPORTED_CODE_LANGUAGES],
          default: 'python',
        },
        description: { type: 'string', description: 'What the code is meant to verify' },
      },
      required: ['code'],
    },
  },
);

/** Tools exposed to the model (Python: `tools = [execute_python_tool]`). */
export const tools = [executeCodeTool];

/**
 * Graph state (Python: `class AgentState(TypedDict)` with `add_messages`).
 */
export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (left: BaseMessage[], right: BaseMessage | BaseMessage[]) =>
      left.concat(Array.isArray(right) ? right : [right]),
    default: () => [],
  }),
});

/**
 * Minimal structural type for a chat model.
 *
 * `@langchain/openai` is an optional dependency that is loaded dynamically
 * (see {@link createChatModel}), so the example type-checks without it.
 */
export interface ChatModelLike {
  invoke(messages: BaseMessage[]): Promise<any>;
  bindTools(tools: unknown[]): ChatModelLike;
}

/** Load `@langchain/openai` dynamically and create the chat model. */
export async function createChatModel(options: Record<string, any>): Promise<ChatModelLike> {
  const packageName: string = '@langchain/openai';
  let module: any;
  try {
    module = await import(packageName);
  } catch (error) {
    throw new Error(
      "The '@langchain/openai' package is required for this example. " +
      "Install it with: pnpm add @langchain/openai",
      { cause: error },
    );
  }
  const { ChatOpenAI } = module;
  return new ChatOpenAI(options);
}

/** Build the prompt, prepending the system message once (Python `call_model`). */
export function promptMessages(state: typeof AgentState.State): BaseMessage[] {
  const messages = state.messages ?? [];
  const hasSystemMessage = messages.some((message) => message instanceof SystemMessage);
  return hasSystemMessage ? messages : [new SystemMessage(SYSTEM_PROMPT), ...messages];
}

/** Extract plain text from a LangChain message (string or content blocks). */
export function messageText(message: any): string {
  const content = message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: any) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('');
  }
  return content === undefined || content === null ? '' : String(content);
}

/** Create the LangGraph workflow (Python: `workflow = StateGraph(AgentState)`). */
export async function buildGraph() {
  // Python: ChatOpenAI(model="DeepSeek-V3", api_key=MODEL_API_KEY, base_url=BASE_URL, ...)
  const model = await createChatModel({
    model: process.env.OPENAI_MODEL_NAME ?? 'DeepSeek-V3',
    apiKey: process.env.MODEL_API_KEY ?? process.env.OPENAI_API_KEY,
    configuration: {
      baseURL: process.env.BASE_URL ?? process.env.OPENAI_BASE_URL,
    },
    maxTokens: 1000,
    temperature: 0.7,
  });

  // Python: `llm = llm.bind_tools(tools)`.
  const boundModel = model.bindTools(tools);

  /** Call the model and return its response (Python `call_model`). */
  const callModel = async (state: typeof AgentState.State) => {
    const response = await boundModel.invoke(promptMessages(state));
    return { messages: [response] };
  };

  /** Continue with the tools node while the model asks for tool calls. */
  const shouldContinue = (state: typeof AgentState.State): 'tools' | typeof END => {
    const lastMessage = state.messages?.at(-1);

    if (lastMessage instanceof AIMessage) {
      const toolCalls = lastMessage.tool_calls ?? [];
      if (toolCalls.length > 0) {
        return 'tools';
      }
    }

    return END;
  };

  const workflow = new StateGraph(AgentState)
    .addNode('agent', callModel)
    .addNode('tools', new ToolNode(tools))
    // Python: `set_entry_point("agent")`.
    .addEdge(START, 'agent')
    // Python: `add_conditional_edges("agent", should_continue, {...})`.
    .addConditionalEdges('agent', shouldContinue, {
      tools: 'tools',
      [END]: END,
    })
    .addEdge('tools', 'agent');

  return workflow.compile();
}

/** Cached graph (built on first use, like Python's module-level `agent`). */
let graphPromise: Promise<Awaited<ReturnType<typeof buildGraph>>> | null = null;

/** Get the compiled graph, building it on first use. */
export function getGraph(): Promise<Awaited<ReturnType<typeof buildGraph>>> {
  graphPromise ??= buildGraph();
  return graphPromise;
}

/** Default question used when the payload carries no message. */
export const DEFAULT_QUERY = '告诉我1到100之间最大的质数';

/**
 * Agent entrypoint.
 *
 * Two request shapes are supported:
 *
 * - `{"code": "print(1)"}` runs the code directly in the sandbox, bypassing the
 *   model. Add `"language": "typescript"` to run TypeScript instead of Python.
 *   Handy for testing the Code Interpreter without model credentials.
 * - `{"message": "..."}` (`query` also accepted) drives the LangGraph
 *   tool-calling loop. Python hard-codes one question; here the payload may
 *   override it, falling back to {@link DEFAULT_QUERY}.
 */
export const handler = app.entrypoint(
  async (payload: Record<string, any>, context?: RequestContext) => {
    // Direct sandbox mode: skip the model entirely.
    const code = typeof payload?.code === 'string' ? payload.code : '';
    if (code.trim()) {
      const language = assertSupportedLanguage(String(payload?.language ?? 'python'));
      return { code, language, result: await runCodeInSandbox(code, language) };
    }

    const query = String(payload?.message ?? payload?.query ?? DEFAULT_QUERY);

    const agent = await getGraph();
    const result = await agent.invoke({ messages: [new HumanMessage(query)] });

    return messageText(result.messages?.at(-1));
  },
);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Starting Agent Tools (Code Interpreter) Example...');
  console.log('');
  console.log('Required environment variables:');
  console.log('  - MODEL_API_KEY / BASE_URL: model credentials');
  console.log('  - OPENAI_MODEL_NAME: Model name');
  console.log('  - HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY: Code Interpreter API Key');
  console.log(
    '  - HUAWEICLOUD_SDK_REGION: Region (falls back to the SDK default region when unset)',
  );
  console.log('  - AGENTARTS_CODE_INTERPRETER_NAME: Code Interpreter name');
  console.log('  - AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT: Data Plane Endpoint');
  console.log('');
  console.log('Endpoints:');
  console.log('  - POST /invocations - Invoke the agent');
  console.log('  - GET  /ping         - Health check');

  handler.run('0.0.0.0', 8080);
}

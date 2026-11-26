# AgentArts SDK — Node.js 移植约定（PORTING.md）

本仓库是 `agentarts-sdk-python` 的 Node.js/TypeScript 移植，两个版本要求目录结构、公共 API、行为一致。
所有移植工作必须遵守本文约定；与 Python 参考实现冲突时，以 Python 行为为准，命名/语言习惯按下述规则转换。

## 1. 参考源

- Python 源码：`../agentarts-sdk-python/src/agentarts/**`
- Python 测试：`../agentarts-sdk-python/tests/**`
- Python 文档：`../agentarts-sdk-python/docs/cn/**`、`README.md`、`examples/**`
- 底座 SDK（Python）：`../agentarts-sdk-python/.venv/Lib/site-packages/huaweicloudsdk{core,iam,swr,agentidentity}`
- 底座 SDK（npm，同版本 3.1.222）：`@huaweicloud/huaweicloud-sdk-core`、`-iam`、`-swr`
  - `agentidentity` 没有 npm/Node 版本，按 Python 版移植到 `packages/huaweicloud-sdk-agentidentity`。
  - 其余底座直接依赖 npm 包，不再维护仓库副本。

## 2. 仓库结构

```
packages/
  huaweicloud-sdk-agentidentity/   # 对应 huaweicloudsdkagentidentity/v1（无 npm 版本，本地移植）
  agentarts-sdk/                   # 主包
    src/
      index.ts                     # 对应 agentarts/__init__.py
      sdk/                         # 对应 agentarts/sdk/
      toolkit/                     # 对应 agentarts/toolkit/
      cli.ts                       # 对应 console script `agentarts`
tests/
  unit/                            # 镜像 Python tests/unit（1:1）
  integration/                     # 镜像 Python tests/integration（默认跳过）
docs/cn/                           # 迁移 Python docs/cn
examples/                          # 迁移 Python examples（langgraph/basic）
```

底座 core / iam / swr 不再维护仓库副本，直接依赖 npm 包：

- `@huaweicloud/huaweicloud-sdk-core@3.1.222`（对应 `huaweicloudsdkcore`）
- `@huaweicloud/huaweicloud-sdk-iam@3.1.222`（对应 `huaweicloudsdkiam/v5`）
- `@huaweicloud/huaweicloud-sdk-swr@3.1.222`（对应 `huaweicloudsdkswr/v2`）

这些上游包是 CJS 且没有 `exports` 映射，因此 TypeScript 源码必须使用带 `.js` 后缀的深层导入
（上游 iam 的 `v5/public-api` 存在损坏的导出，不能从它聚合导入，需按文件逐个导入）：

```ts
import { HcClient } from '@huaweicloud/huaweicloud-sdk-core/HcClient.js';
import { ClientBuilder } from '@huaweicloud/huaweicloud-sdk-core/ClientBuilder.js';
import { SdkResponse } from '@huaweicloud/huaweicloud-sdk-core/SdkResponse.js';
import { Region, BasicCredentials } from '@huaweicloud/huaweicloud-sdk-core';
import { IamClient } from '@huaweicloud/huaweicloud-sdk-iam/v5/IamClient.js';
import { CreateAgencyReqBody } from '@huaweicloud/huaweicloud-sdk-iam/v5/model/CreateAgencyReqBody.js';
import { SwrClient } from '@huaweicloud/huaweicloud-sdk-swr/v2/SwrClient.js';
import { ShowNamespaceRequest } from '@huaweicloud/huaweicloud-sdk-swr/v2/model/ShowNamespaceRequest.js';
```

> 上游已知打包缺陷：`@huaweicloud/huaweicloud-sdk-core@3.1.222` 的
> `http/DefaultUserAgent.js` 在运行期 `require('uuid')`，但其 `package.json` 未声明
> `uuid` 依赖。本仓库通过 `pnpm-workspace.yaml` 的 `packageExtensions` 为其补上
> `uuid@^11.1.1`，同时主包显式声明 `uuid` 依赖，避免 pnpm 严格依赖布局下加载
> `ClientBuilder` 失败。若升级上游版本且其修复了依赖声明，可删除这两处兜底。

`agentarts/sdk/runtime/app.py` → `packages/agentarts-sdk/src/sdk/runtime/app.ts`。

## 3. 命名规则（重要）

| Python | TypeScript |
| --- | --- |
| 方法 / 函数 `create_space()` | `createSpace()`（camelCase） |
| 参数 / 关键字参数 `region_name=` | `regionName` |
| 属性 / 数据类字段 `access_key_id` | `accessKeyId` |
| 类名 `MemoryClient` | `MemoryClient`（不变） |
| 枚举成员 `StrategyType.SEMANTIC` | `StrategyType.SEMANTIC`（不变） |
| 模块级常量 `DEFAULT_REGION` | `DEFAULT_REGION`（不变） |
| 文件名 `iam_client.py` | `iam-client.ts` |
| 目录名 `code_interpreter/` | 保持 `code_interpreter/`（与 Python 结构一致） |
| `__init__.py` | `index.ts` |
| 私有方法 `_handle_invocation` | 保持 `_handleInvocation`（下划线前缀保留，便于与 Python 对照） |

- 属性名冲突 `name` 等可正常使用；Python 的 `to_dict()` → `toDict()`，`from_dict()` → `fromDict()`。
- Python 装饰器（`@require_access_token` 等）→ 返回包装函数的工厂函数，签名与参数名（camelCase）保持一致。
- 异常类名保持不变（`SdkException`、`ServiceResponseException` …），字段 `status_code` → `statusCode`；
  底座 core 的 `ServiceResponseException.httpStatusCode` 保持原样（与上游 Node SDK 一致）。

## 4. 异步

- 所有 I/O 方法返回 `Promise<T>`；不存在同步版本。
- `MemoryClient` 与 `AsyncMemoryClient` 都保留：两者都返回 Promise，`MemoryClient` 是**异步同名类**
  （与 Python 的同步类签名一致，但实现为异步），并导出同样的方法名。
- 不使用回调风格；需要流式时返回 `AsyncIterable` / `ReadableStream`。
- `app.entrypoint` 支持同步函数与返回 Promise 的函数，与 Python 一致。

## 5. 模块与导入

- 每个包 `package.json` 设置 `"type": "module"`，产物为 ESM，`tsc` 构建，`dist/` 保持源码目录结构。
- **相对导入必须带 `.js` 后缀**（NodeNext 要求），例如 `import { x } from './foo.js'`。
- 同包内使用相对路径；跨包使用包名（`@huaweicloud/huaweicloud-sdk-core`、`huaweicloud-sdk-agentidentity`、`agentarts-sdk`）。
- 主包内的 Python `agentarts.sdk.x` ↔ `agentarts-sdk/sdk/x`；`agentarts.toolkit.x` ↔ `agentarts-sdk/toolkit/x`。
- 新增文件后运行 `node tools/add-js-extensions.mjs <dir>` 自动补全后缀（若手写遗漏）。

## 6. 数据模型

Python 数据类（dataclass / pydantic BaseModel / SDK 生成模型）→ TS class：

```ts
export class Tag {
  key?: string;
  value?: string;

  constructor(init?: Partial<Tag>) {
    Object.assign(this, init ?? {});
  }

  /** 对应 Python to_dict()，输出服务端 wire 格式（snake_case）。 */
  toDict(): Record<string, any> {
    const result: Record<string, any> = {};
    if (this.key !== undefined && this.key !== null) result['key'] = this.key;
    return result;
  }

  /** 对应 Python 由响应反序列化。 */
  static fromDict(dict?: Record<string, any> | null): Tag {
    const model = new Tag();
    if (dict) {
      if (dict['key'] !== undefined) model.key = dict['key'];
    }
    return model;
  }
}
```

- 属性用 camelCase；`toDict()` 输出 wire 名称（一般是 snake_case，以 Python `attribute_map` 为准）。
- 只序列化非 `undefined`/`null` 字段（对齐 Python `sanitize_for_serialization` 丢弃 None 的行为）。
- 嵌套模型递归调用 `toDict()`/`fromDict()`；数组逐项处理。
- 构造参数用对象：`new SpaceCreateRequest({ name, description })`。
- 枚举用 TS `enum`，值与 Python 字符串一致。

## 7. 错误与日志

- Python 异常类 → 同名 TS `Error` 子类，保留 `message`；`status_code` → `statusCode`。
- 日志：使用 `agentarts-sdk/sdk/utils/logging` 的 `getLogger(name)`，提供 `debug/info/warning/error/exception`
  （`exception` 打印错误与堆栈）。Python `logger.info("x %s", v)` → `logger.info(\`x ${v}\`)`。
- 不要直接使用 `console.log`（CLI 输出层除外，见 §9）。

## 8. HTTP

- 统一使用全局 `fetch`（Node ≥ 20）或 `agentarts-sdk/sdk/service/http-client` 的封装；不要引入axios 等新依赖。
- `verify_ssl` → `verifySsl`，支持 `boolean | string`（`false` 关闭校验，字符串为 CA 文件路径）。
- `requests`/`httpx` 的 `timeout` → `AbortSignal.timeout(ms)`；流式响应 → `ReadableStream`/`AsyncIterable`。
- 请求头、URL、body 与 Python 完全一致；测试中通过 `vi.stubGlobal('fetch', ...)` 注入响应。

## 9. CLI 与输出

- Python `typer` → `commander`；命令名、选项名（`--port`、`-p`）、别名（`deploy`/`launch`、`config`/`configure`）保持一致。
- Python `rich` 输出 → `packages/agentarts-sdk/src/toolkit/utils/console.ts` 中的 `echoInfo/echoSuccess/echoWarning/echoError/printTable/printPanel`
  以及 `Console` 类（`console.print` 支持简单 rich 标记时，直接输出纯文本即可，颜色可选）。
- `rich.prompt` → `node:readline/promises`。
- 交互/进度条可简化为逐行输出，但命令行为与退出码需一致。

## 10. 测试

- 框架：`vitest`。测试目录与文件名 1:1 对应 Python：
  `tests/unit/sdk/service/test_iam_client.py` → `tests/unit/sdk/service/test_iam_client.test.ts`。
- `unittest.mock.patch` → `vi.spyOn` / `vi.mock`；`Mock()` → `vi.fn()`；`pytest.raises` → `expect(...).rejects.toThrow(...)`。
- 测试从源码导入（vitest alias 已配置）：
  `import { IAMClient } from 'agentarts-sdk/sdk/service/iam-client'`。
- `integration` 测试默认跳过：文件顶部使用
  `const describeIntegration = hasCloudCredentials() ? describe : describe.skip;`（`tests/integration/_helpers.ts` 提供工具），
  不得在无凭据时发起真实网络请求。
- 单元测试不得访问真实网络/云（必要时 mock fetch）。

## 11. 禁止事项

- 不要修改根 `package.json`、`pnpm-workspace.yaml`、`tsconfig*.json`、`vitest*.ts` 或安装新依赖（需要时告知 lead）。
- 不要新增 Python 风格的 `*_test.ts`、snake_case 文件名。
- 不要留下 `TODO`、空实现或跳过的断言来“通过”测试；行为不一致时以 Python 为准。
- 不要删除 Python 中存在的公共导出。

## 12. 验证命令

### Runtime 并发控制的明确差异（issue #10）

Node.js 版增加应用实例共享的 `acquireSlot(): SlotLease` 和可识别的
`ConcurrencyLimitError`。HTTP 自动占用，WebSocket/未来 A2A、AG-UI 适配层按轮次显式占用；
流式响应持有名额直到流执行和清理结束。HTTP/WS `RequestContext.signal` 提供断连通知，
名额仅在实际执行清理后释放。默认及自定义 Healthy 在满载时报告 HealthyBusy，
强制状态和其他健康状态保持优先。maxConcurrency 限定为正的安全整数。

这是针对原移植行为的修复，本次不修改 Python 代码仓，也不代表 Python 已具备同等契约。
Python 后续同步时应复用相同的轮次粒度、流生命周期和跨协议验收场景。
对于没有 `return()` 的迭代器，取消后排空至自然结束（不发送剩余输出），期间保留名额；
排空不与正在执行的读取并发，已结束或已失败的源不会被重新启动。

```bash
# 单包类型检查（不会写文件）
pnpm exec tsc -p packages/agentarts-sdk/tsconfig.json --noEmit

# 单包构建
pnpm exec tsc -p packages/agentarts-sdk/tsconfig.json

# 单元测试（仓库根目录）
pnpm exec vitest run tests/unit/sdk/<...>.test.ts
```

## 13. 可选协议扩展的明确差异

Node.js 新增 `app.use()`、`app.executions`、独立执行完成信号和两个可选协议包。
这些是新增能力，不代表 Python 参考实现已有对应 API。本次保持既有 HTTP/WS 入口行为，
不将 A2A/AG-UI 模型引入基础 SDK。完整入口 createA2aService / createAguiAgent 提供多轮任务、附件、推送/签名/扩展及工具、状态、中断等能力；基础 SDK 提供可替换存储接口和本地持久化。FileProtocolStorage 只支持单 OS 进程，云端透传及分布式执行未验收。
新增 workspace 示例和依赖仅服务于协议功能及互通测试，发布时使用配套 changeset 协调版本。

生产依赖安全审计：底座 core 的缺失依赖补充固定在支持 CommonJS 的 uuid 11 系列（>=11.1.1），
避免 uuid <11.1.1 的缓冲区边界检查公告 GHSA-w5hq-g745-h8pq；不使用 ESM-only 的新主版本替代该兼容依赖。

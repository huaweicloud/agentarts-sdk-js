# Tools 使用指导

## 概述
支持 CodeInterpreter 生命周期管理和 Session 生命周期管理
部分场景支持分页，以确保在处理大型响应时，能够快速且成功的返回结果
> **Note** This document is designed to instruct user how to use AgentArts Tools using SDK

---

## 环境要求

- Node.js 20 及以上
- 已安装 AgentArts SDK：`pnpm add agentarts-sdk`（或 `npm install agentarts-sdk`）

## 认证配置

### 华为云 AK/SK 认证

CodeInterpreter SDK 使用华为云 AK/SK 进行身份认证。请通过以下方式配置：

**方式一：环境变量配置（推荐）**

```bash
# 设置华为云 AK/SK
export HUAWEICLOUD_SDK_AK="your-access-key"
export HUAWEICLOUD_SDK_SK="your-secret-key"
```

### 获取 AK/SK

1. 登录华为云控制台
2. 进入"我的凭证"页面
3. 在"访问密钥"标签页创建或查看 AK/SK

### 会话认证方式

CodeInterpreter 会话使用 API Key 进行认证，可通过以下方式配置：

**方式一：环境变量配置（推荐）**

```bash
export HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY="your-api-key"
```

**方式二：代码中传递参数**

```ts
// 在 startSession 中传递
await ci.startSession('my-code-interpreter', 'my-session', 'your-api-key');

// 在 withCodeSession 中传递（第 4 个参数为 authType，第 5 个为 apiKey）
await withCodeSession('cn-southwest-2', 'my-code-interpreter', async (client) => {
  await client.executeCode("print('Hello')");
}, 'API_KEY', 'your-api-key');
```

**注意**：如果代码解释器创建时使用了 `authType: 'IAM'`，则会话方法将自动使用 IAM 认证，无需传递 `apiKey` 参数。

### 数据面端点配置

CodeInterpreter 数据面端点可以通过以下方式配置（按优先级排序）：

1. **环境变量**（最高优先级）：
   ```bash
   export AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT="https://your-data-endpoint"
   ```

2. **初始化参数**：
   ```ts
   const client = new CodeInterpreter(
     'cn-southwest-2',
     'https://your-data-endpoint',
   );
   ```

3. **默认值**：使用 SDK 内置的默认端点

---

## 快速开始

### 使用 withCodeSession 辅助函数（推荐）

Python 的 `code_session` 是一个上下文管理器；Node.js 版没有 `with` 语法，对应提供
`withCodeSession(...)` 回调式辅助函数，自动管理会话的启动和停止，推荐用于大多数场景：

```ts
import { withCodeSession } from 'agentarts-sdk';

// 使用环境变量中的 API Key
await withCodeSession('cn-southwest-2', 'my-code-interpreter-name', async (client) => {
  // 执行代码
  const result = await client.executeCode("print('Hello, World!')");
  console.log(result);

  // 执行命令
  await client.executeCommand('ls -la');

  // 上传文件
  await client.uploadFile('/home/user/data.csv', 'col1,col2\n1,2\n3,4');

  // 下载文件
  const content = await client.downloadFile('/home/user/output.txt');
});

// 传入 API Key
await withCodeSession(
  'cn-southwest-2',
  'my-code-interpreter-name',
  async (client) => {
    await client.executeCode('import pandas as pd; print(pd.__version__)');
  },
  'API_KEY',
  'your-api-key',
);
```

也可以使用 `codeSession(...)` 返回的 `CodeSession` 对象（实现 `AsyncIterable<CodeInterpreter>`）：

```ts
import { codeSession } from 'agentarts-sdk';

for await (const ci of codeSession('cn-southwest-2', 'my-code-interpreter-name')) {
  await ci.executeCode("print('Hello, World!')");
}
```

### 手动管理会话

如果需要更细粒度的控制，可以手动管理会话：

```ts
import { CodeInterpreter } from 'agentarts-sdk';

// 创建客户端
const client = new CodeInterpreter('cn-southwest-2');

// 启动会话
const sessionId = await client.startSession(
  'my-code-interpreter-name',
  'my-session',
  'your-api-key', // 可选，不传则从环境变量读取
);

// 执行操作
await client.executeCode("print('Hello')");

// 停止会话（可选）
await client.stopSession();
```

---

## 类名
CodeInterpreter

### 初始化

```ts
new CodeInterpreter(
  region: string | null,
  dataEndpoint: string | null = null,
  authType = 'API_KEY',
  verifySsl: boolean | string = true,
)
```

**参数说明**：

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| region | string \| null | 否 | 从环境变量获取 | 华为云区域名称；传 `null` 时回落到 `getRegion()` |
| dataEndpoint | string \| null | 否 | null | 数据面端点，优先从环境变量 `AGENTARTS_CODEINTERPRETER_DATA_ENDPOINT` 读取 |
| authType | string | 否 | "API_KEY" | 认证类型，支持 "API_KEY" 或 "IAM" |
| verifySsl | boolean \| string | 否 | true | 是否验证服务器的 SSL 证书，如果为字符串则作为 CA 证书包路径 |

**使用示例**：

```ts
// 使用环境变量配置（API Key 认证）
const client = new CodeInterpreter('cn-southwest-2');

// 通过参数指定数据面端点
const client2 = new CodeInterpreter('cn-southwest-2', 'https://your-custom-endpoint.com');

// 使用 IAM 认证
const client3 = new CodeInterpreter('cn-southwest-2', null, 'IAM');

// 禁用 SSL 证书验证（不推荐用于生产环境）
const client4 = new CodeInterpreter('cn-southwest-2', null, 'API_KEY', false);

// 使用自定义 CA 证书包
const client5 = new CodeInterpreter('cn-southwest-2', null, 'API_KEY', '/path/to/ca-bundle.crt');
```

### 功能特性
- 管理 CodeInterpreter 实例
- 管理 Session 生命周期

### 属性
- controlPlaneClient: 控制面客户端
- dataPlaneClient: 数据面客户端
- codeInterpreterName: 当前绑定的代码解释器名称
- sessionId: 当前会话 ID

### 方法

> 下文所有方法均为 `async`，返回 `Promise`；返回值与 Python 的 dict 一一对应，
> 即 `Promise<Record<string, any>>`（字段名保持服务端 wire 格式，如 `created_at`）。

#### 1. 创建代码解释器
**方法名** `createCodeInterpreter`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|name |string| **Required**  代码解释器的名称，必须符合特定的命名规则|
|authType |string| 认证类型，支持 "API_KEY" 或 "IAM"，默认 "API_KEY"|
|apiKeyName |string| API Key 的名称，当 authType 为 "API_KEY" 时必填|
|description |string| 代码解释器的描述信息, default: `undefined`|
|executionAgencyName |string| 执行机构的名称, default: `undefined`|
|observability |object| 可观测性配置，例如日志和监控设置, default: `undefined`|
|networkConfig |object| 网络配置，例如 VPC 和安全组设置, default: `undefined`|
|agentGatewayId |string| 关联的 Agent Gateway ID, default: `undefined`|
|tags |Array<{key, value}>| 标签列表，每个标签是一个包含 "key" 和 "value" 的对象, default: `undefined`|

**返回值**
包含代码解释器信息的对象，包括：
+ id(string): 代码解释器的ID
+ name(string): 代码解释器的名称
+ description(string): 代码解释器的描述信息
+ created_at(string): 代码解释器的创建时间
+ updated_at(string): 代码解释器的更新时间
+ execution_agency_name(string): IAM委托名
+ workload_identity(object): 工作负载认证信息
+ access_endpoint(string): 代码解释器的访问域名
+ observability(object): 可观测性配置(日志+指标)
+ tags(Array): 标签列表，每个标签是一个包含 "key" 和 "value" 的对象
+ network_config(object): 网络配置，例如 VPC 和安全组设置

**样例**
```ts
// 使用 API Key 认证创建代码解释器
const codeInterpreter = await client.createCodeInterpreter(
  'my-code-interpreter',
  'API_KEY',
  'my-api-key-name',
);
const codeInterpreterId = codeInterpreter.id;

// 使用 IAM 认证创建代码解释器
const ci = await client.createCodeInterpreter('my-code-interpreter', 'IAM');
```

#### 2. 查询代码解释器列表
**方法名** `listCodeInterpreters`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|name |string| 根据名称模糊查询代码解释器列表, default: `undefined`|
|limit |number| 每页返回的代码解释器数量，默认 10|
|offset |number| 分页偏移量，默认 0|
|sortKey |string| 排序字段，必须是 created_at 或 updated_at, default: `undefined`|
|sortDir |string| 排序方向，必须是 asc 或 desc, default: `undefined`|

**返回值**
包含代码解释器列表和分页信息的对象：
+ total_count(number): 符合查询条件的代码解释器总数
+ items(Array): 代码解释器列表

**样例**
```ts
const result = await client.listCodeInterpreters('my-code-interpreter', 10, 0, 'created_at', 'asc');
```

#### 3. 更新代码解释器
**方法名** `updateCodeInterpreter`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|codeInterpreterId |string| **Required**  代码解释器的ID|
|observability |object| 可观测性配置(日志+指标)，可选|
|tags |Array<{key, value}>| 标签列表，每个标签是一个包含 "key" 和 "value" 的对象，可选|

**返回值**
包含更新后代码解释器信息的对象：
+ id(string): 代码解释器的ID
+ name(string): 代码解释器的名称
+ description(string): 代码解释器的描述信息
+ created_at(string): 代码解释器的创建时间
+ updated_at(string): 代码解释器的更新时间
+ execution_agency_name(string): IAM委托名
+ agent_gateway_id(string): 代码解释器所属的智能体网关ID
+ workload_identity(object): 工作负载认证信息
+ access_endpoint(string): 代码解释器的访问域名
+ observability(object): 可观测性配置(日志+指标)
+ tags(Array): 标签列表

**样例**
```ts
const result = await client.updateCodeInterpreter(
  'my-code-interpreter',
  undefined,
  [{ key: 'env', value: 'dev' }],
);
```

#### 4. 获取代码解释器详情
**方法名** `getCodeInterpreter`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|codeInterpreterId |string| **Required**  代码解释器的ID|

**返回值**
包含代码解释器详情的对象：
+ id(string): 代码解释器的ID
+ name(string): 代码解释器的名称
+ description(string): 代码解释器的描述信息
+ created_at(string): 代码解释器的创建时间
+ updated_at(string): 代码解释器的更新时间
+ execution_agency_name(string): IAM委托名
+ agent_gateway_id(string): 代码解释器所属的智能体网关ID
+ workload_identity(object): 工作负载认证信息
+ access_endpoint(string): 代码解释器的访问域名
+ observability(object): 可观测性配置(日志+指标)
+ tags(Array): 标签列表
+ auth_type(string): 工具认证方式
+ api_key_name(string): API Key名称
+ network_config(object): 网络配置，例如 VPC 和安全组设置

**样例**
```ts
const result = await client.getCodeInterpreter('my-code-interpreter-id');
```

#### 5. 删除代码解释器
**方法名** `deleteCodeInterpreter`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|codeInterpreterId |string| **Required**  代码解释器的ID|

**样例**
```ts
await client.deleteCodeInterpreter('my-code-interpreter-id');
```

#### 6. 启动代码解释器会话
**方法名** `startSession`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|codeInterpreterName |string| **Required**  代码解释器的名称，用于识别和管理会话，名称唯一|
|sessionName |string|  **Required**  会话名称|
|apiKey |string| 认证使用的API Key，如果代码解释器创建时使用 API_KEY 认证，则需要提供此参数；如果不提供则从环境变量 HUAWEICLOUD_SDK_CODE_INTERPRETER_API_KEY 中获取；如果代码解释器创建时使用 IAM 认证，则无需提供此参数, default: `undefined`|
|sessionTimeout |number| 会话超时时间，单位为秒，默认 15 分钟，最小值为 60 秒，最大值为 86400 秒（24小时）, default: `900`|

**返回值**
sessionId (string): 会话ID

**样例**
```ts
// 使用环境变量中的 API Key（代码解释器创建时使用 API_KEY 认证）
const sessionId = await client.startSession('my-code-interpreter-name', 'my-session-name');

// 传入 API Key（代码解释器创建时使用 API_KEY 认证）
const sessionId2 = await client.startSession('my-code-interpreter-name', 'my-session-name', 'your-api-key');

// 代码解释器创建时使用 IAM 认证，无需传入 apiKey
const sessionId3 = await client.startSession('my-code-interpreter-name', 'my-session-name');
```

#### 7. 获取代码解释器会话详情
**方法名** `getSession`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|codeInterpreterName |string| **Required**  代码解释器的名称，用于识别和管理会话，名称唯一|
|sessionId |string| 会话ID，默认使用当前会话ID, default: `undefined`|
|apiKey |string| 认证使用的API Key（要求同 startSession）, default: `undefined`|

**返回值**
包含会话详情的对象：
+ code_interpreter_id(string): 代码解释器的ID
+ created_at(string): 会话的创建时间
+ session_name(string): 会话名称
+ session_id(string): 会话ID
+ session_timeout(number): 会话超时时间，单位为秒

**样例**
```ts
// 使用环境变量中的 API Key（代码解释器创建时使用 API_KEY 认证）
const sessionInfo = await client.getSession('my-code-interpreter-name');

// 代码解释器创建时使用 IAM 认证，无需传入 apiKey
const sessionInfo2 = await client.getSession('my-code-interpreter-name');
```

#### 8. 停止当前代码解释器会话
**方法名** `stopSession`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|apiKey |string| 认证使用的API Key（要求同 startSession）, default: `undefined`|

**返回值**
boolean: 没有活跃会话时返回 true，否则返回 false

**样例**
```ts
// 使用环境变量中的 API Key（代码解释器创建时使用 API_KEY 认证）
await client.stopSession();

// 传入 API Key（代码解释器创建时使用 API_KEY 认证）
await client.stopSession('your-api-key');

// 代码解释器创建时使用 IAM 认证，无需传入 apiKey
await client.stopSession();
```

#### 9. 调用代码解释器会话
**方法名** `invoke`

**注意**：`arguments` 是 JavaScript/TypeScript 的保留字，因此该方法第二个参数名定为 `arguments_`
（调用方式不传参数名，仍按位置顺序传入）。

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|operateType |string| **Required**  调用方法名，"execute_code" 或 "execute_command" 等|
|arguments_ |object| **Required**  调用参数，根据 operateType 不同而不同（wire 字段名保持 snake_case）|
|apiKey |string| 认证使用的API Key（要求同 startSession）, default: `undefined`|

**返回值**
result(object): 包含调用结果的对象

**样例**
```ts
// 使用环境变量中的 API Key（代码解释器创建时使用 API_KEY 认证）
const result = await client.invoke('execute_code', {
  clear_context: false,
  code: "print('Hello, World!')",
  language: 'python',
});

// 代码解释器创建时使用 IAM 认证，无需传入 apiKey
const result2 = await client.invoke('execute_code', {
  clear_context: false,
  code: "print('Hello, World!')",
  language: 'python',
});
```

#### 10. 在代码解释器中执行代码
**方法名** `executeCode`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|code |string| **Required**  要执行的代码|
|language |string| 代码的语言，默认 `"python"`；服务端支持 `python`、`typescript`（见导出常量 `SUPPORTED_CODE_LANGUAGES`）。`javascript` 会被服务端拒绝|
|clearContext |boolean| 是否在执行前清除上下文，默认 false, default: `false`|

**返回值**
result(object): 包含 stdout、stderr、exitcode 信息的对象

**样例**
```ts
// 执行 Python 代码
const result = await client.executeCode(`
    import pandas as pd
    df = pd.DataFrame({'A': [1, 2, 3], 'B': [4, 5, 6]})
    print(df.describe())
`);

// 执行 TypeScript 代码（沙箱原生支持，Node.js 20 也可通过 executeCommand 调用）
const result2 = await client.executeCode(
  'const nums: number[] = [1, 2, 3];\nconsole.log(nums.reduce((a, b) => a + b, 0));',
  'typescript',
);

// 清除上下文
const result3 = await client.executeCode('x = 10', 'python', true);
```

#### 11. 在代码解释器中执行命令
**方法名** `executeCommand`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|command |string| **Required**  要执行的命令|

**返回值**
result(object): 包含命令执行结果的对象

**样例**
```ts
// 列出所有文件
const result = await client.executeCommand('ls -la');

// 检查 python 版本
const result2 = await client.executeCommand('python --version');
```

#### 12. 上传文件到代码解释器
**方法名** `uploadFile`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|path |string| **Required**  文件路径。相对路径以 "/home/user" 为基准；绝对路径必须位于 "/home/user" 之下，越界会抛 "Invalid path"|
|content |string \| Uint8Array| **Required**  文件内容，可以是字符串或二进制数据（`Uint8Array` / `Buffer`），二进制内容将被 Base64 编码|
|description |string| 文件描述，此字段可用于 LLMs 理解数据结构（例如： "CSV" with columns: data, revenue, product_id）, default: `""`|

**返回值**
result(object): 包含文件上传结果的对象

**样例**
```ts
// 上传 CSV 文件
const result = await client.uploadFile(
  '/home/user/my-file.csv',
  'date, revenue\n2026-01-01, 1000\n2026-01-02, 2000',
  'Daily sales data with columns: date, revenue',
);
```

#### 13. 上传多个文件到代码解释器
**方法名** `uploadFiles`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|files |Array<{path, content, description}>| **Required**  文件路径和内容的列表，每个文件包含 "path" 和 "content" 键
  - "path": 文件路径。相对路径以 "/home/user" 为基准；绝对路径必须位于 "/home/user" 之下，越界会抛 "Invalid path"
  - "content": 文件内容（string 或 Uint8Array）
  - "description": 文件描述，此字段可用于 LLMs 理解数据结构|

**返回值**
result(object): 包含文件上传结果的对象

**样例**
```ts
// 上传多个文件
const result = await client.uploadFiles([
  { path: '/home/user/data.txt', content: 'Hello, World!' },
  { path: '/home/user/my-binary-file', content: Buffer.from('123456') },
]);
```

#### 14. 从代码解释器下载文件
**方法名** `downloadFile`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|path |string| **Required**  文件路径，以 "/home/user" 为基准，越界（如 "/home/userxxx/a"）会抛 "Invalid path"|

**返回值**
content(string | Buffer): 文件内容，文本文件返回 string 或字节文件返回 Buffer（图片、PDF 等）

**样例**
```ts
// 下载文件
const content = await client.downloadFile('/home/user/data.txt');
```

#### 15. 从代码解释器下载多个文件
**方法名** `downloadFiles`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|paths |string[]| **Required**  文件路径列表，每条路径以 "/home/user" 为基准，任一越界即抛 "Invalid path"|

**返回值**
files(Record<string, string | Buffer>): 包含文件路径和内容的对象，键为文件路径，值为文件内容（文本或字节）

**样例**
```ts
// 下载多个文件
const files = await client.downloadFiles(['/home/user/data.txt', '/home/user/my-binary-file']);
```

#### 16. 在代码解释器中安装 Python 包
**方法名** `installPackages`

**参数**
| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|packages |string[]| **Required**  要安装的 Python 包列表，支持版本指定，如 ["requests", "numpy==1.24.3"]|
|upgrade |boolean| 是否升级已安装的包，默认 false, default: `false`|

**返回值**
result(object): 包含命令执行结果的对象

**样例**
```ts
// 安装多个 Python 包
const result = await client.installPackages(['requests', 'numpy']);

// 安装指定版本的包
const result2 = await client.installPackages(['requests==2.26.0', 'numpy==1.24.3']);

// 升级已安装的包
const result3 = await client.installPackages(['requests', 'numpy'], true);
```

#### 17. 清除代码解释器上下文
**方法名** `clearContext`

**返回值**
result(object): 包含命令执行结果的对象

**样例**
```ts
await client.executeCode('x = 10');
await client.executeCode('print(x)');
// 清除上下文
const result = await client.clearContext();
await client.executeCode('print(x)');
```

### 会话辅助函数

Python 版通过 `code_session` 上下文管理器管理会话生命周期；Node.js 版提供两种等价方式：

**方法名** `withCodeSession`（回调式，推荐）

```ts
withCodeSession(
  region: string,
  codeInterpreterName: string,
  fn: (ci: CodeInterpreter) => Promise<T> | T,
  authType = 'API_KEY',
  apiKey?: string,
  verifySsl: boolean | string = true,
): Promise<T>
```

**方法名** `codeSession`（返回 `CodeSession`，实现 `AsyncIterable<CodeInterpreter>`）

```ts
codeSession(
  region: string,
  codeInterpreterName: string,
  authType = 'API_KEY',
  apiKey?: string,
  verifySsl: boolean | string = true,
): CodeSession
```

| 参数名 | 类型 | 描述 |
| --- | --- | --- |
|region |string| **Required** region 名称，如 "cn-southwest-2"|
|codeInterpreterName |string| **Required**  代码解释器名称|
|authType |string| 认证类型，支持 "API_KEY" 或 "IAM"，默认 "API_KEY"|
|apiKey |string| 认证使用的API Key（要求同 startSession）, default: `undefined`|

**样例**
```ts
// 使用环境变量中的 API Key（代码解释器创建时使用 API_KEY 认证）
await withCodeSession('cn-southwest-2', 'my-code-interpreter-name', async (client) => {
  await client.executeCode("print('Hello, World!')");
});

// 传入 API Key（代码解释器创建时使用 API_KEY 认证）
await withCodeSession(
  'cn-southwest-2',
  'my-code-interpreter-name',
  async (client) => {
    await client.executeCode("print('Hello, World!')");
  },
  'API_KEY',
  'your-api-key',
);

// 使用 IAM 认证
await withCodeSession(
  'cn-southwest-2',
  'my-code-interpreter-name',
  async (client) => {
    await client.executeCode("print('Hello, World!')");
  },
  'IAM',
);
```

> **导入路径**：上述类与函数可从包根导出导入（`import { CodeInterpreter, codeSession, withCodeSession } from 'agentarts-sdk'`），
> 也可使用模块路径 `import { CodeInterpreter } from 'agentarts-sdk/sdk/tools/index'`（与 Python `agentarts.sdk.tools` 对应）。

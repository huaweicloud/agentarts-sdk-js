# A2A / AG-UI 独立复验报告

> 修复复验：下列 F1–F4 是修复前的结果。现已修复当前轮 MIME 校验、Webhook 等待队列、REST 空体取消及订阅、扩展 Card 校验，并补测 REST 流式续接不会重发未变更的历史产物。Webhook 使用任务内背压，慢回调可能延长同步调用。修复后默认全量测试 2661 通过、1 跳过，包含 126 项协议验收。

验证日期：2026-11-25。对象：当前工作区未提交的实现。此次只增加测试与验收文档，未修改业务实现。

## 验收结论

**当前不通过完整协议及提交验收。** 既有主流程可用，但独立增加的组合场景复现 4 项 A2A 问题，其中 2 项影响常规功能或协议最低投递保证。不能以原有用例全绿替代完整协议语义验收。

AG-UI 在已声明的 HTTP/SSE 范围内，本轮新增 6 项组合用例全部通过，真实输出也通过独立官方 JSON Schema 校验。该结论不是官方完整 TCK 认证，也不包含所有传输绑定与全部可选字段。

## 测试执行结果

| 验证层 | 本轮结果 |
| --- | --- |
| 原有默认测试集（新增用例前） | 2650 通过、1 跳过 |
| 新增独立组合验收 | 6 通过、4 失败，共 10 项；失败未 skip/xfail |
| 新增用例后的默认全量测试 | **2656 通过、4 失败、1 跳过；78 文件通过、1 文件失败** |
| 协议验收集合 | 原有 115 通过；新增 6 通过、4 失败，共 125 项 |
| 既有集成测试 | 49 通过、56 跳过；跳过项不算通过 |
| TypeScript / workspace 构建 | 通过 |
| 编译后的独立示例 | 鉴权、AG-UI 审批/状态重启、A2A 跨 JSON-RPC/REST checkpoint 续接通过 |
| 独立官方 JSON Schema | 9 份真实输入、52 个 SSE 输出事件，0 个校验错误；涵盖 21 种实际输出事件类型 |
| 生产依赖审计 | 未报告已知漏洞；不等于业务安全证明 |

独立 Schema 来自 AG-UI 官方仓库的 docs/spec/1.0/schema.json，与上一轮冻结文件一致，SHA256：
`4b5c93226838a0e72d88e6c5df20633c686c49fcb75d9be2815c6cbf9e48e71a`。
JSON Schema 只检查结构；时序、身份隔离、恢复和投递语义另由真实服务测试验证。

## 已复现的问题及修改建议

### F1 / P1：多轮任务切换输出类型会把正常业务标记为失败

位置：[engine.ts](../../../packages/agentarts-protocol-a2a/src/engine.ts)，最终产物校验循环。

复现：第一轮产生 PDF 并进入 INPUT_REQUIRED；第二轮沿用 taskId，客户端 acceptedOutputModes 改为 text/plain，执行器正常返回 approved。期望任务 COMPLETED；实际 TASK_STATE_FAILED，新增文本结果被回滚。

根因：第二轮的 outputModes 被用于重新校验任务中所有历史 artifacts，第一轮合法 PDF 被当成第二轮的非法输出。问题与执行器是否成功无关。

建议：区分当前轮生成/修改的产物与任务已有产物，对当前轮应用协商结果；历史产物保持原有有效性。补齐 JSON-RPC、REST、gRPC 及流式续接的同类测试，确认不误报终态失败。

用例：review: A2A continuation can negotiate text after a prior PDF artifact。

### F2 / P1：Webhook 并发满载时，有已配置回调从未得到投递尝试

位置：[push.ts](../../../packages/agentarts-protocol-a2a/src/push.ts) 的 pending 配额拒绝，以及 [engine.ts](../../../packages/agentarts-protocol-a2a/src/engine.ts) 的异步发送/仅记录失败分支。

复现：同一任务配置 /one、/two 两个 Webhook，maxPending=1；/one 正常接收但暂缓响应。任务仍成功结束，最终接收列表只有 /one；/two 连一次 HTTP 尝试都没有。

根因：send 在队列满时直接拒绝，没有排队/背压或后续补偿；引擎吞下拒绝，仅记录日志。调整较小并发额度只是稳定复现方式，默认额度也可能被多个配置、多个任务及事件连续占满。

A2A 规范要求对每个已配置 Webhook 至少尝试一次。这里的问题是零次尝试，不是远端失败后没有重试；不能用 best-effort 描述替代最低保证。

建议：实现有界排队和背压，保证已接收更新的配置获得尝试；若无法接受负载，应在接纳前明确拒绝，不能静默丢失已承诺的通知。持久 outbox 可另作更强可靠性方案，但不要求本次必须具备分布式基础设施。

用例：review: every configured webhook gets a delivery attempt when another receiver is slow。

### F3 / P2：REST 无请求体取消操作被强制 JSON 解析拒绝

位置：[service.ts](../../../packages/agentarts-protocol-a2a/src/service.ts)，全局 POST 请求体解析。

复现：对 INPUT_REQUIRED 任务执行 POST /tasks/{id}:cancel，HTTP 使用合法的空 chunked 请求体。期望 200 + CANCELED，实际 400。

根因：只要 POST 的 Content-Length 不等于字符串 0 就调用 json()；空 chunked 请求没有 Content-Length，误入 JSON 解析。此操作不要求消息体。

建议：按操作声明解析请求体，支持空体操作；对真正需要 JSON 的 message:send / message:stream 仍严格拒绝空体、错误内容类型及畸形 JSON。以 Node http 客户端复现，避免 fetch 自动补 Content-Length=0 掩盖问题。

用例：review: REST cancel accepts a valid empty chunked request body。

### F4 / P2：扩展 Card 提供者的错误配置会成功返回不合规 Card

位置：[engine.ts](../../../packages/agentarts-protocol-a2a/src/engine.ts)，getAuthenticatedExtendedAgentCard。

复现：扩展 Card 回调返回缺少 supportedInterfaces 的 Card，接口仍以成功信封返回。官方模型 fromJSON 会补默认值，不能代替协议必填/非空校验。

影响：这是提供者配置容错缺口；正确配置的扩展 Card 主流程可用，但错误配置不会被拦截，客户端可能无法选择绑定或继续调用。

建议：公共/扩展/签名前后的 Card 使用统一校验，检查必填字段、非空 interfaces、版本、绑定、URL 与安全声明的一致性；不合规提供者输出返回脱敏服务端错误。不要自动继承可能改变认证语义的字段。

用例：review: malformed extended cards are rejected rather than returned as a successful discovery response。

## 能力覆盖判断

| 范围 | 判断 |
| --- | --- |
| A2A 操作覆盖 | 发现、发送/流式、查询、列表、取消、订阅、推送 CRUD、扩展 Card 均有实现；接口存在，部分组合语义仍有缺陷 |
| A2A JSON-RPC / REST / gRPC | 既有基本调用、路由 tenant、身份隔离及异常脱敏通过；新发现 REST 空体与共用引擎的 MIME/Webhook 问题 |
| A2A 附件/多轮/恢复 | 单独场景通过；跨轮切换类型失败，不能给完整可用结论 |
| A2A 扩展/签名 | URI 协商和真实签名/验签通过；扩展 Card 提供者输出校验需补齐 |
| AG-UI 工具/状态/多模态 | 多模态工具结果、前端结果回传、状态快照/补丁、官方客户端通过 |
| AG-UI 推理/子 Agent | 加密推理、推理 chunk、嵌套归因、子 Agent 错误后父流程继续、子 Agent suspend + 根 interrupt 通过 |
| AG-UI interrupt/resume | 过期答案拒绝、显式取消、未知答案忽略、失败后保留审批门槛并显式恢复通过 |
| AG-UI 重放 | 官方 HttpAgent 能重放带 pendingToolCallIds 的已完成 run |
| 安全/资源 | 既有鉴权、配额、跨身份访问、CORS、输入限制、异常脱敏、SSRF 拒绝及原型修改防护用例通过；不代表正式渗透测试 |
| 本地持久化 | 单进程 checkpoint/状态恢复及编译后真实进程重启通过；不代表分布式所有权或副作用 exactly-once |

AG-UI 当前入口只提供 HTTP/SSE，不提供 HTTP+Protobuf 绑定；终态 usage 等可选字段也没有完整业务上报 API。这些应在能力说明中明确，不能把已声明配置可用表述成所有绑定、全部可选能力均已实现。A2A 以 Task 模式执行，不提供直接 Message 返回的业务接口；这属于配置范围，不能单凭选择 Task 模式判为协议不合规。

## 复现命令及证据

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm test:integration
pnpm exec vitest run --config vitest.protocol.config.ts tests/acceptance/protocol_conformance_review.test.ts
pnpm audit --prod
```

新增测试：[protocol_conformance_review.test.ts](../../../tests/acceptance/protocol_conformance_review.test.ts)。默认 pnpm test 已包括它，当前真实结果为失败，不应先提交为全绿。

本次日志在本机 /private/tmp/protocol-review-*.log，包括 all-expanded、new、types、build、integration、audit、schema、smoke。通过 AGENTARTS_REVIEW_CAPTURE=/private/tmp/指定文件.json 可收集新增测试的 AG-UI 原始输入与 SSE 事件，用独立 Draft 2020-12 验证器检查官方 Schema。

尚未验证：官方完整 TCK、真实云网关透传、公网 TLS/回调、多实例协调、真实模型与工具后端。用户当前未提供这些环境；不能把跳过项或本地通过计为这部分验收通过。

建议先修复 F1/F2，再修复 F3/F4，并保留当前失败断言复跑全量验收。此次未修改业务代码，未提交或推送。

规范依据：[A2A 1.0 规范](https://a2a-protocol.org/latest/specification/)、[AG-UI interrupt/resume](https://docs.ag-ui.com/spec/1.0/basic/patterns/interrupt-resume)、[AG-UI 官方 Schema](https://github.com/ag-ui-protocol/ag-ui/blob/main/docs/spec/1.0/schema.json)。

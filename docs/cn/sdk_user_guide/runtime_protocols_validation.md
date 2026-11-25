# A2A / AG-UI 本地协议验收记录

> 复验发现的四项 A2A 缺陷已修复。详见 [复验报告与修复记录](runtime_protocols_revalidation.md)。

日期：2026-11-25。基线 `ca0b3e3` 加当前未提交变更。完整功能入口是 `createA2aService` 与 `createAguiAgent`；原文本适配器继续兼容。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| 冻结锁文件安装 | `pnpm install --frozen-lockfile` 通过；离线缓存不完整后使用联网安装恢复并通过 |
| TypeScript | `pnpm typecheck` 通过 |
| 默认全量测试 | **2650 通过、1 跳过，78 个文件通过** |
| 独立协议验收 | **115 通过**：78 项文本/兼容验收 + 37 项完整能力与边界验收；均纳入默认测试 |
| 原有集成测试 | **49 通过、56 跳过**；跳过项不算已验收 |
| workspace 构建 | identity、SDK、A2A、AG-UI、两个示例入口全部通过 |
| 编译产物验收 | 真实子进程启动/退出/重启；AG-UI 审批/共享状态恢复，A2A JSON-RPC → REST checkpoint 续接通过 |
| npm 打包 | 四个 tarball 均包含编译导出、声明、README、LICENSE；未发布 |
| 生产依赖审计 | `pnpm audit --prod` 未报告已知漏洞 |
| 变更格式 | `git diff --check` 通过 |

官方互操作客户端为 `@a2a-js/sdk@1.3.0` 与 `@ag-ui/client@1.0.5`。不宣称通过官方全套 TCK。未提供云端验收地址，因此本地通过不等于云端透传已验收。

## 完整能力的验收范围

新增用例位于 [full_protocols.test.ts](../../../tests/acceptance/full_protocols.test.ts)：

- A2A 同 taskId 多轮 INPUT_REQUIRED 续接；checkpoint、context 与历史保持；暂停任务和完成结果跨存储重开仍可使用。
- 已结束执行记录的 messageId 去重；崩溃遗留 owner 转为 INPUT_REQUIRED，读取不自动重执行业务，只在显式续接时执行。
- structured data（含 null）、远程文件引用、二进制 PDF artifact；输入 MIME 拒绝、返回产物验证及相同 artifactId 替换。
- JSON-RPC 与 REST 共享任务及身份隔离；实际 gRPC 服务调用；三种绑定对路由 tenant 的一致传播；官方 A2A ClientFactory 发现/发送/列表。
- 扩展 required 协商与执行器激活 URI；最终能力 Card 的真实 JWS 签名/验签，认证扩展 Card。
- Webhook 实际回环接收；配置创建、JSON-RPC/REST 分页、查询、删除和跨身份拒绝；私网/元数据/file/URL 凭据目的地拒绝。
- ProtoJSON 字段先验证再进入官方 codec；拒绝多内容 oneof、错误字段类型与不合法 base64。
- AG-UI 工具调用/参数/结果、前端工具结果回传、官方 chunk 展开；状态 snapshot/delta，reasoning/activity/step/subagent/CUSTOM/RAW。
- 官方 HttpAgent 将工具与共享状态应用到客户端；事件使用官方 schema、时序验证与 reducer。
- 多模态输入保留；同 run 完成快照重放、不重复输出；同 run 并发不重复执行。
- interrupt/checkpoint/state 跨存储重开恢复；缺少答案拒绝、跨用户无法读原 checkpoint。
- 无效状态补丁/原型修改、未闭合工具事件不伪报成功。
- 完整 A2A/AG-UI 共用 runtime 容量；取消时实际清理完成前不释放名额。
- AES-GCM 文件持久化、跨实例原子增量、记录容量、危险 JSON 键、错误密钥；失败写入不损坏旧记录。
- 持久化故障不报告成功；存储恢复后 owner 不永久锁死，允许显式业务恢复。
- JSON-RPC / REST / gRPC 对存储提供者异常统一脱敏，不暴露内部路径与异常原文。

保留的 [runtime_protocols.test.ts](../../../tests/acceptance/runtime_protocols.test.ts) 另覆盖：文本数组归一化、前向兼容字段/版本、路由 tenant 与认证身份分离、JSON-RPC 错误信封、终态订阅拒绝、任务列表/签名游标、认证超时与配额、CORS、请求体限制、断流和慢消费者等。

## 复现

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:protocol
pnpm test
pnpm test:integration
pnpm build
pnpm audit --prod
```

运行真实服务：

```sh
export AGENTARTS_PROTOCOL_TOKEN="$(openssl rand -hex 32)"
export AGENTARTS_PROTOCOL_STORAGE_KEY="$(openssl rand -hex 32)"
pnpm --filter agentarts-protocol-example start:full
```

保持相同目录与密钥重启，再使用新 runId 或同一 taskId 续接。具体 curl 示例见 [示例 README](../../../examples/protocol_agent/README.md)。测试仅使用本机回环端口和假凭据，不依赖真实云凭据或模型服务。

## 部署与业务验收边界

- FileProtocolStorage 仅支持一个 OS 进程操作同一目录。替换存储接口不自动提供分布式任务所有权、跨节点事件或集群并发限制。
- checkpoint 恢复需要业务设计幂等键；无法保证外部副作用 exactly-once。运行中断后不会自动重放未知副作用。
- Webhook 是有界 best-effort 投递，配置持久化，但没有跨进程重启的持久 outbox；接收方应幂等处理并通过查询补偿。
- 附件传输与工具事件已提供；实际文件获取、可信工具注册、业务授权、扩展语义及推理模型仍由业务回调实现。
- AG-UI 恢复使用新 runId；没有活跃 run 网络重连继续消费的承诺。完成快照只在有界保留窗口内可重放。
- 未验收实际云网关发现路径/版本头/认证头/SSE 透传、部署 TLS、真实模型与公网 Webhook；这些需要提供对应环境。
- 本轮未提交、推送或发布。

规范参考：[A2A](https://a2a-protocol.org/latest/specification/)、[AG-UI](https://docs.ag-ui.com/spec/1.0)。

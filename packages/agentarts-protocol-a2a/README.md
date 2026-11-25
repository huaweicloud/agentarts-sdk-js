# AgentArts A2A protocols

Optional A2A 1.0 package using the official @a2a-js/sdk 1.3.0. Base SDK imports do not load this package.

`createA2aService({ runtime, agentCard, authenticate, execute, storage })` provides authenticated JSON-RPC, HTTP+JSON REST and gRPC bindings backed by one task engine. It returns an Express `http` application, `grpcDefinition`, `grpcService`, `handler`, and `close()`.

Supports discovery, send/stream/query/list/cancel/subscribe, multi-turn waiting tasks, structured/file parts and artifacts, extension negotiation, authenticated extended cards, signing hooks, push configuration CRUD/pagination and allowlisted webhook delivery. Attachments are passed to application code; URLs are never automatically fetched.

`execute(message, context)` receives official typed models; return text or `{ state, artifacts, checkpoint }`, or use `emitArtifact`, `setStatus` and `saveCheckpoint`. A waiting task resumes with a new user message carrying its taskId. The executor must finish actual cleanup before settling its promise. Verified tenant/subject identity scopes every record; routing tenant is validated separately.

`FileProtocolStorage` provides optional AES-GCM local persistence and explicit checkpoint recovery. Use one OS process per directory; distributed ownership and durable webhook outbox are not implemented. Callback delivery is bounded best-effort. HTTPS and explicit allowed webhook origins are required outside loopback tests.

`createA2aAdapter()` remains the simpler in-memory JSON-RPC text profile for compatibility; it does not provide full-service features. New applications requiring these features should use createA2aService.

Run the workspace example with `pnpm --filter agentarts-protocol-example start:full` after building and configuring a random AGENTARTS_PROTOCOL_TOKEN. See examples/protocol_agent and docs/cn/sdk_user_guide/runtime_protocols.md for full contracts and limits. Packages are not yet published; cloud gateway and multi-instance deployment acceptance remain outstanding.

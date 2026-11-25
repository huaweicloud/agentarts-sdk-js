# AgentArts AG-UI protocols

Optional AG-UI 1.0 HTTP/SSE package using official core, encoder and client 1.0.5. Base SDK imports do not load this package.

```ts
import { AgentArtsRuntimeApp, FileProtocolStorage } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import { createAguiAgent, EventType } from '@huaweicloud/agentarts-protocol-agui';
const runtime = new AgentArtsRuntimeApp({ maxConcurrency: 4 });
runtime.use(createAguiAgent({ authenticate, storage: new FileProtocolStorage('./.agentarts-protocol'),
  execute(input, context) {
    context.emit({ type: EventType.STATE_SNAPSHOT, snapshot: { ready: true } });
    context.emitText('Hello');
  },
}));
runtime.run();
```

The full producer accepts validated multimodal input and all standard message roles. It supports tools/results, state snapshots/patches, interrupt/resume, reasoning/activity/subagent/step/custom/raw events and official chunk expansion. Official sequencing validation and state/message reduction run before durable completion.

`context.interrupt(interrupts, checkpoint)` ends the run with an interrupt outcome. Resume using a new runId, the same threadId and an explicit answer for each pending interrupt. Checkpoints, state and completed snapshots survive reopening FileProtocolStorage. Active-run reconnect is not provided: interrupted execution requires a new runId and explicit business recovery.

`callTool` emits a tool invocation, never executes untrusted client code. Frontend results return in subsequent tool messages. Application code must authorize tools, state and privileged messages. Media references are preserved without automatic URL access.

Authentication is required; identities are derived from verified credentials, not payload IDs. CORS is exact allowlist only. Disconnect requests cancellation and retains the shared runtime permit until cleanup really finishes. Output, replay, stored data and authentication are bounded. Local persistence supports optional AES-GCM; one OS process per directory, no distributed ownership guarantee.

`createAguiAdapter()` remains the legacy text-only convenience profile. Use createAguiAgent for the full producer. Example: `pnpm --filter agentarts-protocol-example start:full` after building and configuring AGENTARTS_PROTOCOL_TOKEN. See docs/cn/sdk_user_guide/runtime_protocols.md for limits and contracts. Packages are not yet published; cloud gateway and multi-instance deployment are unverified.

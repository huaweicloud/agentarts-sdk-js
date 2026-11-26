import { randomUUID } from 'node:crypto';
import { AbstractAgent, defaultApplyEvents, transformChunks, verifyEvents } from '@ag-ui/client';
import { EMPTY, Subject } from 'rxjs';
import { EventSchema } from '@ag-ui/core/schemas';
import { EventType } from '@ag-ui/core';
import type { Event, RunAgentInput, Message, State, RunFinishedOutcome } from '@ag-ui/core';
import { protocolSnapshot } from '@huaweicloud/agentarts-sdk/sdk/runtime';
import jsonPatch from 'fast-json-patch';

class SnapshotAgent extends AbstractAgent {
  override run() { return EMPTY; }
}
/** Use the official sequencing verifier/reducer for all 31 event types, not a second partial FSM. */
export class AguiSession {
  private readonly inputEvents = new Subject<Event>();
  private readonly checkedEvents = new Subject<Event>();
  private failure: unknown;
  private terminal = false;
  private helperMessage?: string;
  private readonly agent: SnapshotAgent;
  private readonly subscriptions;
  private readonly reduced: Promise<void>;
  private currentState: State;
  constructor(readonly input: RunAgentInput, publish: (event: Event) => void) {
    this.agent = new SnapshotAgent({ threadId: input.threadId, initialMessages: input.messages, initialState: input.state ?? {} });
    this.currentState = protocolSnapshot(input.state ?? {});
    let resolveReduced!: () => void;
    let rejectReduced!: (error: unknown) => void;
    this.reduced = new Promise<void>((resolve, reject) => { resolveReduced = resolve; rejectReduced = reject; });
    void this.reduced.catch(() => {});
    const reduce = defaultApplyEvents(input, this.checkedEvents, this.agent, [], false).subscribe({
      next: update => {
        if (update.messages) this.agent.setMessages(update.messages);
        if (update.state !== undefined) this.agent.setState(update.state);
      },
      error: error => { this.failure = error; rejectReduced(error); },
      complete: resolveReduced,
    });
    const verify = this.inputEvents.pipe(transformChunks(false), verifyEvents(false)).subscribe({
      next: event => {
        try {
          const value = protocolSnapshot(EventSchema.parse(event));
          if (value.type === EventType.STATE_SNAPSHOT) this.currentState = protocolSnapshot(value.snapshot);
          if (value.type === EventType.STATE_DELTA) this.currentState = jsonPatch.applyPatch(protocolSnapshot(this.currentState), value.delta, true, false, true).newDocument;
          this.checkedEvents.next(value);
          if (this.failure) throw this.failure;
          publish(value);
        } catch (error) { this.failure = error; }
      },
      error: error => { this.failure = error; this.checkedEvents.complete(); rejectReduced(error); },
      complete: () => this.checkedEvents.complete(),
    });
    this.subscriptions = [reduce, verify];
    this.send({ type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId, protocolVersion: '1.0', ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}) });
  }
  get messages(): Message[] { return protocolSnapshot(this.agent.messages); }
  get state(): State { return protocolSnapshot(this.currentState); }
  private send(event: Event): void {
    if (this.failure) throw this.failure;
    const value = protocolSnapshot(EventSchema.parse(event));
    this.inputEvents.next(value);
    if (this.failure) throw this.failure;
  }
  emit(event: Event): void {
    if (this.terminal || ['RUN_STARTED', 'RUN_FINISHED', 'RUN_ERROR'].includes(event.type)) throw new Error('Run lifecycle is owned by the adapter');
    this.send(event);
  }
  text(delta: string): void {
    if (!this.helperMessage) {
      this.helperMessage = randomUUID();
      this.emit({ type: EventType.TEXT_MESSAGE_START, messageId: this.helperMessage, role: 'assistant' });
    }
    this.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: this.helperMessage, delta });
  }
  async finish(outcome: RunFinishedOutcome, result?: unknown): Promise<void> {
    if (this.helperMessage) { this.emit({ type: EventType.TEXT_MESSAGE_END, messageId: this.helperMessage }); this.helperMessage = undefined; }
    this.send({ type: EventType.RUN_FINISHED, threadId: this.input.threadId, runId: this.input.runId, outcome, ...(result !== undefined ? { result } : {}) });
    this.terminal = true;
    this.inputEvents.complete();
    await this.reduced;
    if (this.failure) throw this.failure;
  }
  async fail(): Promise<void> {
    if (!this.failure && !this.terminal) this.send({ type: EventType.RUN_ERROR, message: 'Agent execution failed', code: 'EXECUTION_FAILED' });
    this.terminal = true;
    this.inputEvents.complete(); this.checkedEvents.complete();
    await this.reduced.catch(() => {});
  }
  dispose(): void {
    this.inputEvents.complete(); this.checkedEvents.complete();
    for (const subscription of this.subscriptions) subscription.unsubscribe();
  }
}

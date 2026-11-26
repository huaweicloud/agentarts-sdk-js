import { ExecutionError, boundedInteger } from './execution.js';
import { protocolSnapshot } from './storage.js';

/** Bounded transport-independent event fanout. A slow subscriber fails explicitly. */
export class ProtocolEventJournal<T> {
  private readonly history: Array<{ sequence: number; value: T; bytes: number }> = [];
  private readonly waiting = new Set<() => void>();
  private retained = 0;
  private cursor = 0;
  private subscribers = 0;
  private ended = false;
  constructor(private readonly maxEvents = 256, private readonly maxBytes = 512 * 1024, private readonly maxSubscribers = 16) {
    boundedInteger(maxEvents, 'maxEvents'); boundedInteger(maxBytes, 'maxBytes'); boundedInteger(maxSubscribers, 'maxSubscribers');
  }
  get sequence() { return this.cursor; }
  publish(value: T): void {
    if (this.ended) throw new ExecutionError('CONFLICT', 'Event journal closed');
    const snapshot = protocolSnapshot(value, this.maxBytes);
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    this.history.push({ sequence: ++this.cursor, value: snapshot, bytes }); this.retained += bytes;
    while (this.history.length > this.maxEvents || this.retained > this.maxBytes) this.retained -= this.history.shift()!.bytes;
    this.wake();
  }
  finish(): void { this.ended = true; this.wake(); }
  private wake() { for (const resolve of [...this.waiting]) resolve(); }
  subscribe(after = 0, signal?: AbortSignal): AsyncIterableIterator<T> {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.cursor) throw new ExecutionError('INVALID_INPUT', 'Invalid event cursor');
    if (this.subscribers >= this.maxSubscribers) throw new ExecutionError('CAPACITY', 'Subscriber limit');
    this.subscribers++;
    let closed = false;
    const close = () => { if (!closed) { closed = true; this.subscribers--; signal?.removeEventListener('abort', close); this.wake(); } };
    signal?.addEventListener('abort', close, { once: true });
    if (signal?.aborted) close();
    const journal = this;
    const stream = (async function* () {
      let cursor = after;
      try {
        while (!closed) {
          if (cursor < journal.cursor) {
            const entry = journal.history.find(event => event.sequence === cursor + 1);
            if (!entry) throw new ExecutionError('HISTORY_LOST', 'Event history lost');
            cursor = entry.sequence;
            yield protocolSnapshot(entry.value, journal.maxBytes);
          } else if (journal.ended) return;
          else await new Promise<void>(resolve => {
            const resume = () => { journal.waiting.delete(resume); resolve(); };
            journal.waiting.add(resume);
            if (closed || journal.ended || cursor < journal.cursor) resume();
          });
        }
      } finally { close(); }
    })();
    return { [Symbol.asyncIterator]() { return this; }, next: () => stream.next(), async return() { close(); return stream.return(); } };
  }
}

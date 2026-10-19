type Consumer<T> = { resolve: (value: T) => void; reject: (reason: unknown) => void; cleanup: () => void };
type Entry<T> = { controller: AbortController; consumers: Set<Consumer<T>> };
const cancelled = () => new DOMException('Request cancelled', 'AbortError');

/** In-flight GET sharing only. Settled results are never cached. */
export class SharedReads {
  private session = '';
  private entries = new Map<string, Entry<unknown>>();
  get size() { return this.entries.size; }
  setSession(session: string) {
    if (session === this.session) return;
    this.session = session;
    for (const entry of this.entries.values()) {
      entry.controller.abort();
      for (const consumer of entry.consumers) { consumer.cleanup(); consumer.reject(cancelled()); }
      entry.consumers.clear();
    }
    this.entries.clear();
  }
  run<T>(key: string, session: string, signal: AbortSignal | null | undefined, start: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.setSession(session);
    if (signal?.aborted) return Promise.reject(cancelled());
    let entry = this.entries.get(key) as Entry<T> | undefined;
    const created = !entry;
    if (!entry) {
      entry = { controller: new AbortController(), consumers: new Set() };
      this.entries.set(key, entry as Entry<unknown>);
    }
    const current = entry;
    const result = new Promise<T>((resolve, reject) => {
      const consumer: Consumer<T> = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      const abort = () => {
        consumer.cleanup(); current.consumers.delete(consumer); reject(cancelled());
        // React cleanup/remount can attach a replacement in the same turn.
        queueMicrotask(() => {
          if (!current.consumers.size && this.entries.get(key) === current) {
            this.entries.delete(key); current.controller.abort();
          }
        });
      };
      current.consumers.add(consumer);
      signal?.addEventListener('abort', abort, { once: true });
    });
    if (created) {
      const settle = (value: T | undefined, failed: boolean, reason?: unknown) => {
        if (this.entries.get(key) !== current) return;
        this.entries.delete(key);
        for (const consumer of current.consumers) {
          consumer.cleanup();
          if (failed) consumer.reject(reason); else consumer.resolve(value as T);
        }
        current.consumers.clear();
      };
      Promise.resolve().then(() => {
        if (current.controller.signal.aborted) throw cancelled();
        return start(current.controller.signal);
      }).then(value => settle(value, false), reason => settle(undefined, true, reason));
    }
    return result;
  }
}

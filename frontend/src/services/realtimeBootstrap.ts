export type Versions = Record<string, number>;
export type WorkspaceMessage = { kind?: 'ready' | 'change'; versions?: Versions; topics?: string[] };
const cancelled = () => new DOMException('Session changed', 'AbortError');

/** Coordinates the first read with subscribe-first SSE, with an offline fallback. */
export class RealtimeBootstrap {
  private session = '';
  private ready = false;
  private released = false;
  private timer?: ReturnType<typeof setTimeout>;
  private waiters = new Set<{ resolve: () => void; reject: (reason: unknown) => void; cleanup: () => void }>();
  private snapshots = new Map<string, Versions>();
  private seen: Versions = {};
  private notified: Versions = {};
  private pending = new Set<string>();
  private dispatching = false;
  private epoch = 0;
  get revision() { return this.epoch; }
  constructor(private notify: (topics: string[]) => void, private timeout = 1500) {}
  setSession(session: string) {
    if (session === this.session) return;
    this.dispose(); this.session = session;
    this.ready = false; this.released = false; this.seen = {}; this.notified = {}; this.snapshots.clear();
    if (session) this.timer = setTimeout(() => this.release(), this.timeout);
  }
  private release() {
    this.released = true; clearTimeout(this.timer);
    for (const waiter of this.waiters) { waiter.cleanup(); waiter.resolve(); }
    this.waiters.clear();
  }
  wait(signal?: AbortSignal | null): Promise<void> {
    if (signal?.aborted) return Promise.reject(cancelled());
    if (this.released) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) };
      const abort = () => { waiter.cleanup(); this.waiters.delete(waiter); reject(cancelled()); };
      this.waiters.add(waiter); signal?.addEventListener('abort', abort, { once: true });
    });
  }
  private invalidate(versions: Versions) {
    for (const [topic, version] of Object.entries(versions)) {
      if (version > (this.notified[topic] ?? -1)) { this.notified[topic] = version; this.pending.add(topic); this.epoch++; }
    }
    if (this.dispatching || !this.pending.size) return;
    this.dispatching = true;
    const session = this.session;
    queueMicrotask(() => {
      if (session !== this.session) return;
      this.dispatching = false;
      const topics = [...this.pending].sort(); this.pending.clear();
      if (topics.length) this.notify(topics);
    });
  }
  observeRead(key: string, versions: Versions) {
    if (!this.ready) {
      this.snapshots.set(key, versions);
      if (this.snapshots.size > 256) this.snapshots.delete(this.snapshots.keys().next().value!);
    } else {
      // Also covers a fallback request still in flight when ready arrived.
      this.invalidate(Object.fromEntries(Object.entries(versions).filter(([topic, version]) => (this.seen[topic] ?? 0) > version).map(([topic]) => [topic, this.seen[topic]])));
    }
  }
  receive(message: WorkspaceMessage) {
    if (!message.versions) {
      // Compatibility with an older backend during a rolling deployment.
      if (message.topics?.length) { this.epoch++; this.notify(message.topics); }
      this.release(); return;
    }
    const versions = Object.fromEntries(Object.entries(message.versions).filter(([, version]) => Number.isSafeInteger(version) && version >= 0));
    if (!this.ready) {
      this.ready = true; this.seen = versions;
      for (const snapshot of this.snapshots.values()) this.observeRead('', snapshot);
      this.snapshots.clear(); this.release(); return;
    }
    const changed = Object.fromEntries(Object.entries(versions).filter(([topic, version]) => version > (this.seen[topic] ?? 0)));
    for (const [topic, version] of Object.entries(changed)) this.seen[topic] = version;
    this.invalidate(changed);
  }
  dispose() {
    clearTimeout(this.timer);
    for (const waiter of this.waiters) { waiter.cleanup(); waiter.reject(cancelled()); }
    this.waiters.clear(); this.pending.clear(); this.dispatching = false;
  }
}

export const workspaceBootstrap = new RealtimeBootstrap(topics => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('workspace:changed', { detail: topics }));
});

export function readScopes(endpoint: string): string[] {
  const path = endpoint.split('?')[0];
  if (path === '/api/tasks/collection' || path === '/api/tasks/calendar/page') return ['tasks'];
  if (path === '/api/calendar/days') return ['calendar', 'tasks'];
  if (path === '/api/calendar/events/collection') return ['calendar'];
  if (path === '/api/notes/collection/page') return ['notes'];
  if (path === '/api/bookmarks') return ['bookmarks'];
  if (path === '/api/notifications/summary') return ['notifications'];
  if (path === '/api/access/me' || path === '/api/calendar-sharing/received') return ['calendar-sharing'];
  if (path.startsWith('/api/calendar-sharing/view/')) return ['shared-calendar', 'calendar-sharing'];
  return [];
}

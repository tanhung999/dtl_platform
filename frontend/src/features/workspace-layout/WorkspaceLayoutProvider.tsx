import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../services/api';
import { LayoutConflictError } from './layoutErrors';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

import { Layout, LayoutKind } from './types';
export type { LayoutKind } from './types';
import { workspaceOrderApi } from './api';
const empty = (): Layout => ({ apps: { ids: [], version: 0 }, bookmarks: { ids: [], version: 0 }, notes: { ids: [], version: 0 } });
const Context = createContext<{ layout: Layout; busy: boolean; loading: boolean; error: string; save: (kind: LayoutKind, ids: string[], pins?: Record<string, boolean>) => Promise<void> } | null>(null);

export function orderedItems<T extends { id: string }>(items: T[], ids: string[]): T[] {
  const rank = new Map(ids.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? ids.length) - (rank.get(b.id) ?? ids.length));
}

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const [layout, setLayout] = useState(empty);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const locked = useRef(false), revision = useRef(0);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('layout')) setRefresh(value => value + 1); };
    window.addEventListener(WORKSPACE_CHANGED, changed);
    return () => window.removeEventListener(WORKSPACE_CHANGED, changed);
  }, []);
  useEffect(() => {
    const controller = new AbortController(), version = revision.current;
    workspaceOrderApi.get(controller.signal).then(value => { if (!controller.signal.aborted && version === revision.current && !locked.current) { setLayout(value); setError(''); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const save = async (kind: LayoutKind, ids: string[], pins: Record<string, boolean> = {}) => {
    if (locked.current) throw new Error('Đang lưu thứ tự. Vui lòng thử lại.');
    const previous = layout[kind];
    locked.current = true; setBusy(true);
    revision.current += 1;
    setLayout(value => ({ ...value, [kind]: { ...previous, ids } }));
    try {
      const updated = await workspaceOrderApi.save(kind, ids, previous.version, pins);
      revision.current += 1; setLayout(value => ({ ...value, [kind]: updated })); setError('');
    } catch (reason) {
      revision.current += 1; setLayout(value => ({ ...value, [kind]: previous }));
      setError(reason instanceof Error ? reason.message : 'Không thể lưu thứ tự.');
      if (reason instanceof ApiError && reason.status === 409) {
        let refreshed = false;
        try {
          const latest = await workspaceOrderApi.get();
          revision.current += 1; setLayout(latest); setError(''); refreshed = true;
        } catch { /* Keep the last known order; the regular refresh also retries a read. */ }
        throw new LayoutConflictError(refreshed);
      }
      throw reason;
    }
    finally { locked.current = false; setBusy(false); setRefresh(value => value + 1); }
  };
  return <Context.Provider value={{ layout, busy, loading, error, save }}>{children}</Context.Provider>;
}

export function useWorkspaceLayout() { const context = useContext(Context); if (!context) throw new Error('WorkspaceLayoutProvider is required'); return context; }

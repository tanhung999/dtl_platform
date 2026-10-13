import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { request } from '../../services/api';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

export type LayoutKind = 'apps' | 'bookmarks' | 'notes';
interface Order { ids: string[]; version: number }
type Layout = Record<LayoutKind, Order>;
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
    request<Layout>('/api/workspace/layout', { signal: controller.signal }).then(value => { if (!controller.signal.aborted && version === revision.current) { setLayout(value); setError(''); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const save = async (kind: LayoutKind, ids: string[], pins: Record<string, boolean> = {}) => {
    if (locked.current) throw new Error('Đang lưu thứ tự. Vui lòng thử lại.');
    locked.current = true; setBusy(true);
    try {
      const updated = await request<Order>(`/api/workspace/layout/${kind}`, { method: 'PUT', body: JSON.stringify({ ids, expected_version: layout[kind].version, pin_changes: pins }) });
      revision.current += 1; setLayout(value => ({ ...value, [kind]: updated })); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu thứ tự.'); setRefresh(value => value + 1); throw reason; }
    finally { locked.current = false; setBusy(false); }
  };
  return <Context.Provider value={{ layout, busy, loading, error, save }}>{children}</Context.Provider>;
}

export function useWorkspaceLayout() { const context = useContext(Context); if (!context) throw new Error('WorkspaceLayoutProvider is required'); return context; }

import { useInvalidation } from '../realtime/useInvalidation';
import { useEffect, useState } from 'react';
import { notesApi } from './api';
import { NoteCollection } from './types';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { NoteFilter } from './noteView';
export function useNotesCollection({ archived, filter, query, fullPage, offset }: { archived: boolean; filter: NoteFilter; query: string; fullPage: boolean; offset: number }) {
  const [data, setData] = useState<NoteCollection>(), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [revision, refresh] = useInvalidation();
  const [debounced, setDebounced] = useState(query);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => {
    const change = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('notes')) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, change);
    return () => window.removeEventListener(WORKSPACE_CHANGED, change);
  }, [refresh]);
  const key = `${archived}/${filter}/${debounced}/${fullPage}/${offset}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    if (debounced.trim().length === 1) {
      setLoading(false); setError(''); setLoadedKey(key);
      setData(value => value ? { ...value, items: [], total: 0, has_more: false, hidden: 0, next_refresh_at: null } : undefined);
      return;
    }
    const controller = new AbortController(); setLoading(true); setError('');
    notesApi.collection({ archived, filter, query: debounced, fullPage, offset }, controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setLoadedKey(key); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được ghi chú.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, revision]);
  useEffect(() => {
    if (!data?.next_refresh_at || loadedKey !== key) return;
    const delay = Date.parse(data.next_refresh_at) - Date.parse(data.server_now);
    const timer = setTimeout(refresh, Math.min(2147483647, Math.max(1000, delay)));
    return () => clearTimeout(timer);
  }, [data, loadedKey, key, refresh]);
  return { data: loadedKey === key && query === debounced ? data : undefined, loading: loading || query !== debounced || (!error && loadedKey !== key), error, refresh };
}

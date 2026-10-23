import { useEffect, useRef, useState } from 'react';

interface RangePage<T> { items: T[]; total: number; truncated: boolean }
const identity = (item: { id: string }) => 'kind' in item ? `${item.kind}:${item.id}` : item.id;

/** Keep the current grid mounted during refresh; all pages still come from the server. */
export function useRangeCollection<T extends { id: string }, P extends RangePage<T>>(
  key: string, revision: number, fetchPage: (offset: number, signal: AbortSignal) => Promise<P>, enabled = true,
) {
  const [saved, setSaved] = useState<{ key: string; page: P; items: T[]; nextOffset: number }>();
  const [pending, setPending] = useState(true);
  const [failure, setFailure] = useState<{ key: string; message: string }>();
  const error = failure?.key === key ? failure.message : '';
  const setError = (message: string) => setFailure(message ? { key, message } : undefined);
  const active = useRef<AbortController>();
  const moreBusy = useRef(false);
  const latest = useRef(saved);
  latest.current = saved;
  useEffect(() => {
    active.current?.abort();
    if (!enabled) { setPending(false); setError(''); return; }
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError('');
    const target = latest.current?.key === key ? latest.current.nextOffset : 0;
    const read = async () => {
      let page = await fetchPage(0, controller.signal);
      const items = new Map(page.items.map(item => [identity(item), item]));
      let nextOffset = page.items.length;
      while (!controller.signal.aborted && page.truncated && nextOffset < target && page.items.length) {
        page = await fetchPage(nextOffset, controller.signal);
        nextOffset += page.items.length;
        page.items.forEach(item => items.set(identity(item), item));
      }
      if (!controller.signal.aborted) setSaved({ key, page, items: [...items.values()], nextOffset });
    };
    read().catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được dữ liệu.'); })
      .finally(() => { if (!controller.signal.aborted) setPending(false); });
    return () => active.current?.abort();
  }, [key, revision, fetchPage, enabled]);

  const current = enabled && saved?.key === key ? saved : undefined;
  const loadMore = async () => {
    if (!current || pending || !current.page.truncated || moreBusy.current) return;
    moreBusy.current = true;
    const controller = new AbortController(); active.current = controller;
    setPending(true); setError('');
    try {
      const page = await fetchPage(current.nextOffset, controller.signal);
      if (!controller.signal.aborted) setSaved(previous => {
        if (!previous || previous.key !== key) return previous;
        const merged = new Map(previous.items.map(item => [identity(item), item]));
        page.items.forEach(item => merged.set(identity(item), item));
        return { key, page, items: [...merged.values()], nextOffset: current.nextOffset + page.items.length };
      });
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải thêm được dữ liệu.'); }
    finally { moreBusy.current = false; if (!controller.signal.aborted) setPending(false); }
  };
  return { items: current?.items ?? [], page: current?.page, error: enabled ? error : '',
    loading: enabled && (pending || !current && !error), loadMore,
    truncated: !!current?.page.truncated, total: current?.page.total ?? 0 };
}

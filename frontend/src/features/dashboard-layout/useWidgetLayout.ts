import { useEffect, useRef, useState } from 'react';
import { widgetLayoutApi } from './api';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { normalizeWidgetColumns, WidgetColumns, WidgetLayout } from './widgetLayout';

export function useWidgetLayout() {
  const [layout, setLayout] = useState<WidgetLayout>({ columns: normalizeWidgetColumns({}), version: 0, schema_version: 1 });
  const [loading, setLoading] = useState(true), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const locked = useRef(false), revision = useRef(0);
  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('widget-layout')) setRefresh(value => value + 1); };
    const focus = () => setRefresh(value => value + 1);
    window.addEventListener(WORKSPACE_CHANGED, changed); window.addEventListener('focus', focus);
    return () => { window.removeEventListener(WORKSPACE_CHANGED, changed); window.removeEventListener('focus', focus); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), started = revision.current;
    widgetLayoutApi.get(controller.signal).then(value => {
      if (!controller.signal.aborted && started === revision.current && !locked.current) {
        setLayout({ ...value, columns: normalizeWidgetColumns(value.columns) }); setLoaded(true); setError('');
      }
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);
  const save = async (columns: WidgetColumns, expectedVersion = layout.version) => {
    if (locked.current || !loaded) throw new Error('Chưa thể lưu bố cục. Vui lòng thử lại.');
    const previous = layout;
    locked.current = true; setBusy(true); revision.current += 1;
    setLayout({ ...previous, columns });
    try {
      const updated = await widgetLayoutApi.save(columns, expectedVersion);
      revision.current += 1; setLayout({ ...updated, columns: normalizeWidgetColumns(updated.columns) }); setError('');
      return updated;
    } catch (reason) {
      revision.current += 1; setLayout(previous);
      throw reason;
    } finally { locked.current = false; setBusy(false); setRefresh(value => value + 1); }
  };
  return { layout, loading, loaded, busy, error, save };
}

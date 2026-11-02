import { useEffect, useState } from 'react';
import { CheckCheck, MessageSquare, RotateCcw } from 'lucide-react';
import { requestWithTimeout } from '../../../services/requestTimeout';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';

interface Entry { id: string; action: 'COMPLETED' | 'REOPENED' | 'RESULT_UPDATED'; note: string | null; occurred_at: string | null; is_snapshot: boolean }
interface Page { items: Entry[]; total: number; offset: number; limit: number; has_more: boolean }
const labels = { COMPLETED: 'Đã hoàn thành', REOPENED: 'Đã mở lại công việc', RESULT_UPDATED: 'Đã cập nhật kết quả' };
const icons = { COMPLETED: CheckCheck, REOPENED: RotateCcw, RESULT_UPDATED: MessageSquare };

export function TaskResultHistory({ taskId, version, active }: { taskId: string; version: number; active: boolean }) {
  const [offset, setOffset] = useState(0), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<Page>(), [loading, setLoading] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    const refresh = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes('tasks')) setRetry(value => value + 1); };
    window.addEventListener(WORKSPACE_CHANGED, refresh);
    return () => window.removeEventListener(WORKSPACE_CHANGED, refresh);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); setLoading(true); setError('');
    requestWithTimeout<Page>(`/api/tasks/${encodeURIComponent(taskId)}/result-history?offset=${offset}&limit=20`, { signal:controller.signal, cache:'no-store' })
      .then(value => { if (!controller.signal.aborted) setPage(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không tải được lịch sử cập nhật.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, taskId, version, offset, retry]);
  return <section className="task-result-history" hidden={!active} aria-label="Lịch sử cập nhật">
    {active && <div className="task-result-history-body" aria-busy={loading}>
      {loading && <p className="task-history-message" role="status">Đang tải lịch sử…</p>}
      {error ? <div className="task-history-error" role="alert">{error}<button type="button" className="btn btn-outline btn-sm" onClick={() => setRetry(value=>value+1)}>Thử lại</button></div>
        : !loading && page && !page.items.length ? <p className="task-history-message">Chưa có cập nhật kết quả.</p>
        : <ol>{page?.items.map(entry => { const Icon=icons[entry.action]; return <li key={entry.id} data-action={entry.action}>
          <span className="task-history-icon"><Icon size={15} aria-hidden="true" /></span><div>
            <strong>{entry.is_snapshot ? 'Kết quả trước đây' : labels[entry.action]}</strong>
            {entry.note && <p>{entry.note}</p>}
            <small>{entry.occurred_at ? <time dateTime={entry.occurred_at}>{new Date(entry.occurred_at).toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false })}</time> : 'Trước khi có lịch sử cập nhật'}</small>
          </div></li>; })}</ol>}
      {page && page.total>page.limit && <div className="task-history-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={loading || !offset} onClick={()=>setOffset(value=>Math.max(0,value-20))}>Trước</button><span>{offset+1}–{offset+page.items.length} / {page.total}</span><button type="button" className="btn btn-outline btn-sm" disabled={loading || !page.has_more} onClick={()=>setOffset(value=>value+20)}>Sau</button></div>}
    </div>}
  </section>;
}

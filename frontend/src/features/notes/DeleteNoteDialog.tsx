import { RecurrenceScopePicker, occurrenceFor, type RecurrenceScope } from '../calendar/components/RecurrenceScope';
import { notesApi, notifyNotesChanged } from './api';
import type { NoteSchedule } from '../note-scheduling/types';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDeleteInfo, DeleteStatusUnknownError } from './deleteNote';
import './notes.css';
import { ApiError } from '../../services/api';
interface Props {
  occurrenceAt?: string;
  onScopedDelete?: () => void;
  note: { id: string; title?: string };
  onClose: () => void;
  onDelete: (verifyOnly?: boolean, expectedVersion?: number) => Promise<void>;
}
export function DeleteNoteDialog({ note, occurrenceAt, onScopedDelete, onClose, onDelete }: Props) {
  const [seriesRecurrence, setSeriesRecurrence] = useState<string | null>();
  const [referenceAt, setReferenceAt] = useState<string>();
  const [scope, setScope] = useState<RecurrenceScope>('THIS');
  const [schedule, setSchedule] = useState<NoteSchedule>();
  const recurring = !!seriesRecurrence || !!schedule?.recurrence && schedule.recurrence !== 'NONE';
  const at = schedule ? occurrenceFor(schedule.starts_at, schedule.recurrence, occurrenceAt ?? referenceAt) : undefined;
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const deleting = useRef(false);
  const headingId = useId(), descriptionId = useId();
  const [info, setInfo] = useState<{ title: string; has_calendar_schedule: boolean; version: number }>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(''), [deleteError, setDeleteError] = useState('');
  const [revision, setRevision] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement as HTMLElement | null;
    element?.showModal(); cancel.current?.focus({ preventScroll: true });
    return () => { element?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setLoadError(''); setInfo(undefined);
    getDeleteInfo(note.id, controller.signal).then(async value => { const full = value.has_calendar_schedule ? await notesApi.get(note.id, controller.signal) : undefined; if (!controller.signal.aborted) { setInfo(value); setSchedule(full?.calendar_schedule ?? undefined); setReferenceAt(full?.calendar_occurrence_at ?? undefined); setSeriesRecurrence(full?.calendar_series_recurrence); } })
      .catch(reason => { if (!controller.signal.aborted) setLoadError(reason instanceof Error ? reason.message : 'Không tải được thông tin ghi chú.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [note.id, revision]);
  const title = (info?.title ?? note.title)?.trim() || 'Ghi chú không có tiêu đề';
  const remove = async (verifyOnly = false) => {
    if (deleting.current || loading || loadError || !info) return;
    deleting.current = true; setBusy(true); setDeleteError('');
    try { if (recurring && scope !== 'ALL') { await notesApi.remove(note.id, info.version, {scope, occurrence_at:at!}); notifyNotesChanged(); onScopedDelete?.(); } else await onDelete(verifyOnly, info.version); onClose(); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) setRevision(value => value + 1);
      setUncertain(reason instanceof DeleteStatusUnknownError); setDeleteError(reason instanceof Error ? reason.message : 'Không thể xóa ghi chú. Vui lòng thử lại.');
    }
    finally { deleting.current = false; setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="note-delete-dialog" aria-labelledby={headingId} aria-describedby={descriptionId}
    onCancel={event => { event.preventDefault(); event.stopPropagation();  }}
    onKeyDown={event => { if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); event.stopPropagation(); } }}
    onClick={event => event.stopPropagation()}>
    <header className="note-delete-heading"><h2 id={headingId}>Xóa ghi chú?</h2><button type="button" className="task-icon-button" aria-label="Đóng xác nhận xóa" disabled={busy} onClick={onClose}>×</button></header>
    <p className="note-delete-title" title={title}>{title}</p>
    <div id={descriptionId}>{recurring && <RecurrenceScopePicker action="delete" at={at!} value={scope} onChange={setScope} disabled={busy} />}<p>{recurring && scope !== 'ALL' ? 'Chỉ xóa các lần trên lịch đã chọn; nội dung ghi chú và các lần còn lại được giữ.' : 'Ghi chú sẽ bị xóa vĩnh viễn.'}</p>
      {loading ? <p role="status">Đang kiểm tra ghi chú…</p> : info && info.has_calendar_schedule && (!recurring || scope === 'ALL') && <p>Lịch gắn với ghi chú cũng sẽ bị xóa, bao gồm toàn bộ các lần lặp. Các thông báo còn chờ sẽ bị hủy.</p>}
    </div>
    {loadError && <div className="note-delete-error" role="alert"><span>{loadError}</span><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setRevision(value => value + 1)}>Thử lại</button></div>}
    {deleteError && <p className="note-delete-error" role="alert">{deleteError}</p>}
    {uncertain && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { void remove(true); }}>Kiểm tra lại kết quả</button>}
    <footer><button ref={cancel} type="button" className="btn btn-outline" disabled={busy} onClick={onClose}>Hủy</button><button type="button" className="btn note-delete-confirm" disabled={busy || uncertain || loading || !!loadError || !info} onClick={() => { void remove(); }}>{busy ? 'Đang xóa…' : 'Xóa ghi chú'}</button></footer>
  </dialog>, document.body);
}

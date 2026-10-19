import { notesApi, notifyNotesChanged } from './api';
import { useEffect, useState } from 'react';
import { Archive, ArrowUpRight, Plus, X } from 'lucide-react';
import { FeatureIcon } from '../../components/FeatureIcon';
import { ApiError } from '../../services/api';
import { Note } from '../../types';
import { NoteModal } from './NoteModal';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { NoteCard } from './NoteCard';
import { NoteFilter } from './noteView';
import { NoteWrite } from './types';
import { useTasks } from '../tasks/context/TasksContext';
import { NotesDropArea, SortableWidgetSection } from '../workspace-layout/SortableWidgetSection';
import { NotesPinZone, SortableWidgetGroup } from '../workspace-layout/SortableWidgets';
import { useNotesCollection } from './useNotesCollection';
import { NoteSummary } from './types';
import { createNoteWithRetry, NoteCreateAttempt } from './createNote';
import { deleteNoteWithRecovery } from './deleteNote';
import './notes.css';
interface Props { fullPage?: boolean; initialFilter?: NoteFilter; onOpenAll?: (filter: NoteFilter) => void }
export function NotesWidget({ fullPage = false, initialFilter = 'all', onOpenAll }: Props) {
  const [sortBusy, setSortBusy] = useState(false);
  const [localOrder, setLocalOrder] = useState<{ ids: string[]; version?: number }>();
  const { now } = useTasks();
  const [archived, setArchived] = useState(false), [filter, setFilter] = useState<NoteFilter>(initialFilter);
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0);
  const collection = useNotesCollection({ archived, filter, query, fullPage, offset });
  const data = collection.data, loading = collection.loading;
  const [selectedNote, setSelectedNote] = useState<Note | null>(null), [isModalOpen, setIsModalOpen] = useState(false);
  const [actionError, setActionError] = useState(''), [sortError, setSortError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<NoteSummary | null>(null), [actionBusy, setActionBusy] = useState(false);
  const [localPins, setLocalPins] = useState<Record<string, boolean>>({}), [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [hasScheduledNotes, setHasScheduledNotes] = useState(false);
  useEffect(() => { setHiddenIds([]); }, [archived, filter, query, offset]);
  useEffect(() => { if (data) { setHasScheduledNotes(data.has_scheduled); if (!data.has_scheduled && filter === 'scheduled') setFilter('all'); } }, [data, filter]);
  useEffect(() => {
    if (!data) return;
    setLocalPins(value => Object.fromEntries(Object.entries(value).filter(([id, pinned]) => data.pinned_ids.includes(id) !== pinned)));
    setHiddenIds(value => value.filter(id => data.items.some(note => note.id === id)));
  }, [data]);
  useEffect(() => { if (localOrder?.version !== undefined && data && data.order_version >= localOrder.version) setLocalOrder(undefined); }, [data, localOrder]);
  useEffect(() => { setLocalOrder(undefined); }, [archived, filter, query, offset]);
  const serverIds = data?.items.map(note => note.id) ?? [];
  const completeOrder = localOrder?.ids ?? serverIds;
  const pinned = Object.fromEntries((data?.items ?? []).map(note => [note.id, localPins[note.id] ?? note.is_pinned]));
  const rank = new Map(completeOrder.map((id, index) => [id, index]));
  const notes = (data?.items ?? []).filter(note => !hiddenIds.includes(note.id)).map(note => ({ ...note, is_pinned: pinned[note.id] ?? note.is_pinned })).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const sections = [{ id: 'notes-pinned', notes: notes.filter(note => note.is_pinned) }, { id: 'notes-unpinned', notes: notes.filter(note => !note.is_pinned) }];
  const disabled = archived || actionBusy || sortBusy || loading;
  const refresh = () => { collection.refresh(); notifyNotesChanged(); };
  const open = async (note: NoteSummary | null) => {
    setActionError('');
    if (!note) { setSelectedNote(null); setIsModalOpen(true); return; }
    setActionBusy(true);
    try { setSelectedNote(await notesApi.get(note.id)); setIsModalOpen(true); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Không mở được ghi chú.'); }
    finally { setActionBusy(false); }
  };
  const saveNote = async (payload: NoteWrite, attempt?: NoteCreateAttempt) => {
    if (selectedNote) await notesApi.updateNote(selectedNote.id, { ...payload, expected_version: payload.expected_version ?? selectedNote.version });
    else { if (!attempt) throw new Error('Thiếu mã yêu cầu tạo ghi chú.'); await createNoteWithRetry(payload, attempt); }
    refresh();
  };
  const deleteNote = async (id: string, verifyOnly = false, expectedVersion?: number) => { await deleteNoteWithRecovery(id, verifyOnly, expectedVersion); setHiddenIds(value => [...value, id]); refresh(); };
  const archiveNote = async (id: string, expectedVersion: number, payload: NoteWrite) => {
    await notesApi.updateNote(id, { ...payload, is_archived: true, expected_version: expectedVersion });
    setHiddenIds(value => [...value, id]); refresh();
  };
  const change = async (note: NoteSummary, payload: Partial<Note>) => {
    if (actionBusy) return;
    setActionBusy(true); setActionError('');
    try { await notesApi.updateNote(note.id, { ...payload, expected_version: note.version }); refresh(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Không lưu được ghi chú.'); }
    finally { setActionBusy(false); }
  };
  return <div className={`glass-panel widget-box notes-widget ${fullPage ? 'notes-full-collection' : ''}`}>
    <div className="widget-header"><div className="widget-title"><FeatureIcon name="notes" /><span>{fullPage ? 'Ghi chú (Notes)' : 'Ghi Chú Nhanh (Notes)'}</span></div>
      <button type="button" className="btn btn-secondary btn-sm" title="Tạo ghi chú mới" onClick={() => { if (archived) { setArchived(false); setFilter('all'); setOffset(0); } open(null); }}><Plus size={14} /><span>Thêm</span></button>
    </div>
    {fullPage && <div className="notes-page-tools"><label className="notes-search">Tìm ghi chú<input className="form-input" type="search" placeholder="Tìm theo tiêu đề hoặc nội dung…" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
      <button type="button" className={`notes-archive-toggle ${archived ? 'is-active' : ''}`} aria-pressed={archived} onClick={() => { setArchived(value => !value); setFilter('all'); setOffset(0); }}><Archive size={15} />{archived ? 'Đang xem lưu trữ' : 'Đã lưu trữ'}</button></div>}
    {(hasScheduledNotes || fullPage) && <div className="notes-filters" role="group" aria-label="Lọc ghi chú">{([{ value: 'all', label: 'Tất cả' }, ...(hasScheduledNotes ? [{ value: 'scheduled', label: 'Có lịch' }] : []), { value: 'pinned', label: 'Ghim' }] as { value: NoteFilter; label: string }[]).map(option => <button key={option.value} type="button" aria-pressed={filter === option.value} className={filter === option.value ? 'is-active' : ''} onClick={() => { setFilter(option.value); setOffset(0); }}>{option.label}</button>)}</div>}
    {query.trim().length === 1 && <p className="notes-empty">Nhập ít nhất 2 ký tự để tìm kiếm.</p>}
    {(actionError || collection.error) && <div className="alert-error" role="alert">{actionError || collection.error}<button type="button" onClick={() => { collection.refresh(); }}>Thử lại</button></div>}
    {sortError && <div className="notes-sort-error" role="alert"><span>{sortError}</span><button type="button" aria-label="Đóng lỗi lưu thứ tự" onClick={() => setSortError('')}><X size={15} /></button></div>}
    {loading && !notes.length ? <p className="notes-empty" role="status">Đang tải ghi chú…</p> : !notes.length ? <p className="notes-empty">{archived ? 'Chưa có ghi chú đã lưu trữ phù hợp.' : query || filter !== 'all' ? 'Không có ghi chú phù hợp.' : 'Chưa có ghi chú nào. Bấm Thêm để tạo ghi chú đầu tiên.'}</p> :
      <SortableWidgetGroup partitioned silent revision={data?.order_version ?? 0}
        // Send a relative move; hidden and unloaded notes stay on the server.
        ids={completeOrder} disabled={disabled} pinned={pinned}
        onSort={async (ids, activeId, pin, restorePin, edge) => {
          if (!data) return;
          const nextPin = restorePin !== undefined ? restorePin : pin ? true : undefined;
          const activePinned = nextPin ?? pinned[activeId];
          const group = ids.filter(id => (id === activeId ? activePinned : pinned[id]) === activePinned);
          const index = group.indexOf(activeId), movedUp = ids.indexOf(activeId) < completeOrder.indexOf(activeId);
          const placement = pin ? 'start' : edge ?? (movedUp ? 'before' : 'after');
          const anchorId = placement === 'before' ? group[index + 1] : placement === 'after' ? group[index - 1] : undefined;
          setSortBusy(true); setLocalOrder({ ids });
          if (nextPin !== undefined) setLocalPins(value => ({ ...value, [activeId]: nextPin }));
          try {
            const saved = await notesApi.move(activeId, { expected_version: data.order_version, placement: anchorId ? placement : placement === 'end' ? 'end' : 'start', anchor_id: anchorId, pinned: nextPin });
            setLocalOrder({ ids, version: saved.version }); collection.refresh(); setSortError('');
          } catch (reason) {
            setLocalOrder(undefined); setLocalPins(value => { const next = { ...value }; delete next[activeId]; return next; });
            setSortError(reason instanceof ApiError && reason.status === 409 ? 'Danh sách đã thay đổi. Vui lòng kéo lại.' : 'Không lưu được thứ tự. Đã trở về vị trí trước đó.');
            collection.refresh(); throw reason;
          } finally { setSortBusy(false); }
        }}><NotesDropArea disabled={disabled}>{!archived && <NotesPinZone disabled={disabled} />}{sections.map(section => <SortableWidgetSection key={section.id} id={section.id} ids={section.notes.map(note => note.id)} disabled={disabled}>
          {section.notes.map(note => <NoteCard key={note.id} group={section.id} note={note} event={note.scheduled_event} now={now} disabled={actionBusy || sortBusy || loading}
            onOpen={() => { void open(note); }} onPin={() => { void change(note, { is_pinned: !note.is_pinned }); }} onRestore={() => { void change(note, { is_archived: false }); }}
            onDelete={() => setDeleteTarget(note)} />)}
        </SortableWidgetSection>)}</NotesDropArea></SortableWidgetGroup>}
    {fullPage && data && data.total > 0 && <div className="notes-pagination"><span>{data.offset + 1}–{data.offset + data.items.length} / {data.total} ghi chú</span><button type="button" className="btn btn-outline btn-sm" disabled={loading || data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - data.limit))}>Trang trước</button><button type="button" className="btn btn-outline btn-sm" disabled={loading || !data.has_more} onClick={() => setOffset(data.offset + data.limit)}>Trang sau</button></div>}
    {!fullPage && onOpenAll && (data?.pinned_total ?? 0) > 6 && <button type="button" className="notes-view-all" onClick={() => onOpenAll('pinned')}>Xem tất cả ghim ({data?.pinned_total})<ArrowUpRight size={14} /></button>}
    {!fullPage && onOpenAll && <button type="button" className="notes-view-all" onClick={() => onOpenAll(filter)}><span>Xem tất cả{(data?.hidden ?? 0) > 0 ? ` · còn ${data?.hidden} ghi chú` : ''}</span><ArrowUpRight size={14} /></button>}
    {deleteTarget && <DeleteNoteDialog note={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={(verifyOnly, expectedVersion) => deleteNote(deleteTarget.id, verifyOnly, expectedVersion)} />}
    <NoteModal note={selectedNote} isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onSave={saveNote} onDelete={deleteNote} onArchive={archiveNote} />
  </div>;
}

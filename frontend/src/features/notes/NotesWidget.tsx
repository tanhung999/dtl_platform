import { useViewMemory, useWindowScrollMemory, isText, isOffset } from '../../services/viewMemory';
import { notesApi, notifyNotesChanged } from './api';
import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, Plus } from 'lucide-react';
import { FeatureIcon } from '../../components/FeatureIcon';
import { Note } from '../../types';
import { NoteModal } from './NoteModal';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { NoteCard } from './NoteCard';
import { NoteFilter } from './noteView';
import { NoteWrite } from './types';
import { useTasks } from '../tasks/context/TasksContext';
import { useNotesCollection } from './useNotesCollection';
import { NoteSummary } from './types';
import { createNoteWithRetry, NoteCreateAttempt } from './createNote';
import { deleteNoteWithRecovery } from './deleteNote';
import './notes.css';
interface Props { fullPage?: boolean; initialFilter?: NoteFilter; onOpenAll?: (filter: NoteFilter) => void }
export function NotesWidget({ fullPage = false, initialFilter = 'all', onOpenAll }: Props) {
  const { now } = useTasks();
  const [archived, setArchived] = useViewMemory(`notes/${fullPage}/archived`, () => false, value => typeof value === 'boolean');
  const [filter, setFilter] = useViewMemory<NoteFilter>(`notes/${fullPage}/filter`, () => initialFilter, value => ['all', 'scheduled', 'pinned'].includes(String(value)));
  const [query, setQuery] = useViewMemory(`notes/${fullPage}/query`, () => '', isText);
  const [offset, setOffset] = useViewMemory(`notes/${fullPage}/offset`, () => 0, isOffset);
  const collection = useNotesCollection({ archived, filter, query, fullPage, offset });
  const data = collection.data, loading = collection.loading;
  useWindowScrollMemory(`notes/${fullPage}/${filter}/${archived}/${query}/${offset}`, !!data && !loading);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null), [isModalOpen, setIsModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<NoteSummary | null>(null), [actionBusy, setActionBusy] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [hasScheduledNotes, setHasScheduledNotes] = useState(false);
  const opening = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  useEffect(() => () => { opening.current.generation++; opening.current.controller?.abort(); }, []);
  useEffect(() => { setHiddenIds([]); }, [archived, filter, query, offset]);
  useEffect(() => { if (data) { setHasScheduledNotes(data.has_scheduled); if (!data.has_scheduled && filter === 'scheduled') setFilter('all'); } }, [data, filter]);
  useEffect(() => { if (data) setHiddenIds(value => value.filter(id => data.items.some(note => note.id === id))); }, [data]);
  const notes = (data?.items ?? []).filter(note => !hiddenIds.includes(note.id));
  const refresh = () => { collection.refresh(); notifyNotesChanged(); };
  const open = async (note: NoteSummary | null) => {
    opening.current.controller?.abort();
    const generation = ++opening.current.generation;
    setActionError('');
    if (!note) { setActionBusy(false); setSelectedNote(null); setIsModalOpen(true); return; }
    const controller = new AbortController(); opening.current.controller = controller;
    setActionBusy(true);
    try {
      const value = await notesApi.get(note.id, controller.signal);
      if (opening.current.generation === generation && !controller.signal.aborted) { setSelectedNote(value); setIsModalOpen(true); }
    }
    catch (reason) { if (opening.current.generation === generation && !controller.signal.aborted) setActionError(reason instanceof Error ? reason.message : 'Không mở được ghi chú.'); }
    finally { if (opening.current.generation === generation) setActionBusy(false); }
  };
  const close = () => { opening.current.generation++; opening.current.controller?.abort(); setIsModalOpen(false); };
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
    <div className="widget-header"><div className="widget-title"><FeatureIcon name="notes" /><span>DT My Note</span></div>
      <button type="button" className="btn btn-secondary btn-sm" title="Tạo ghi chú mới" onClick={() => { if (archived) { setArchived(false); setFilter('all'); setOffset(0); } open(null); }}><Plus size={14} /><span>Thêm</span></button>
    </div>
    {fullPage && <div className="notes-page-tools"><label className="notes-search">Tìm ghi chú<input className="form-input" type="search" placeholder="Tìm theo tiêu đề hoặc nội dung…" value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></label>
      <button type="button" className={`notes-archive-toggle ${archived ? 'is-active' : ''}`} aria-pressed={archived} onClick={() => { setArchived(value => !value); setFilter('all'); setOffset(0); }}><Archive size={15} />{archived ? 'Đang xem lưu trữ' : 'Đã lưu trữ'}</button></div>}
    {(hasScheduledNotes || fullPage) && <div className="notes-filters" role="group" aria-label="Lọc ghi chú">{([{ value: 'all', label: 'Tất cả' }, ...(hasScheduledNotes ? [{ value: 'scheduled', label: 'Có lịch' }] : []), { value: 'pinned', label: 'Ghim' }] as { value: NoteFilter; label: string }[]).map(option => <button key={option.value} type="button" aria-pressed={filter === option.value} className={filter === option.value ? 'is-active' : ''} onClick={() => { setFilter(option.value); setOffset(0); }}>{option.label}</button>)}</div>}
    {query.trim().length === 1 && <p className="notes-empty">Nhập ít nhất 2 ký tự để tìm kiếm.</p>}
    {(actionError || collection.error) && <div className="alert-error" role="alert">{actionError || collection.error}<button type="button" onClick={() => { collection.refresh(); }}>Thử lại</button></div>}
    {query.trim().length === 1 ? null : loading && !notes.length ? <p className="notes-empty" role="status">Đang tải ghi chú…</p> : !notes.length ? <p className="notes-empty">{archived ? 'Chưa có ghi chú đã lưu trữ phù hợp.' : query || filter !== 'all' ? 'Không có ghi chú phù hợp.' : 'Chưa có ghi chú nào. Bấm Thêm để tạo ghi chú đầu tiên.'}</p> :
      <div className="notes-grid" aria-busy={loading}>{notes.map(note => <NoteCard key={note.id} note={note} event={note.scheduled_event} now={now} disabled={actionBusy || loading}
        onOpen={() => { void open(note); }} onPin={() => { void change(note, { is_pinned: !note.is_pinned }); }} onRestore={() => { void change(note, { is_archived: false }); }}
        onDelete={() => setDeleteTarget(note)} />)}</div>}
    {fullPage && query.trim().length !== 1 && data && data.total > 0 && <div className="notes-pagination"><span>{data.offset + 1}–{data.offset + data.items.length} / {data.total} ghi chú</span><button type="button" className="btn btn-outline btn-sm" disabled={loading || data.offset === 0} onClick={() => setOffset(Math.max(0, data.offset - data.limit))}>Trang trước</button><button type="button" className="btn btn-outline btn-sm" disabled={loading || !data.has_more} onClick={() => setOffset(data.offset + data.limit)}>Trang sau</button></div>}
    {!fullPage && onOpenAll && (data?.pinned_total ?? 0) > 6 && <button type="button" className="notes-view-all" onClick={() => onOpenAll('pinned')}>Xem tất cả ghim ({data?.pinned_total})<ArrowUpRight size={14} /></button>}
    {!fullPage && onOpenAll && <button type="button" className="notes-view-all" onClick={() => onOpenAll(filter)}><span>Xem tất cả{(data?.hidden ?? 0) > 0 ? ` · còn ${data?.hidden} ghi chú` : ''}</span><ArrowUpRight size={14} /></button>}
    {deleteTarget && <DeleteNoteDialog note={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={(verifyOnly, expectedVersion) => deleteNote(deleteTarget.id, verifyOnly, expectedVersion)} />}
    {isModalOpen && <NoteModal key={selectedNote?.id ?? 'new-note'} note={selectedNote} isOpen onClose={close} onSave={saveNote} onDelete={deleteNote} onArchive={archiveNote} />}
  </div>;
}

import { ArrowUpRight, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Note } from '../../types';
import { NoteCard } from './NoteCard';
import { NoteModal } from './NoteModal';
import { DeleteNoteDialog } from './DeleteNoteDialog';
import { notesApi, notifyNotesChanged } from './api';
import { createNoteWithRetry, NoteCreateAttempt } from './createNote';
import { deleteNoteWithRecovery } from './deleteNote';
import { useNotesCollection } from './useNotesCollection';
import { NoteSummary, NoteWrite } from './types';
import { useTasks } from '../tasks/context/TasksContext';
import './notes.css';

interface PinnedNotesWidgetProps {
  onOpenAll?: () => void;
}

export function PinnedNotesWidget({ onOpenAll }: PinnedNotesWidgetProps) {
  const { now } = useTasks();
  const collection = useNotesCollection({
    archived: false,
    filter: 'pinned',
    query: '',
    fullPage: false,
    offset: 0,
  });

  const data = collection.data;
  const loading = collection.loading;

  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<NoteSummary | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  const opening = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });

  useEffect(() => () => {
    opening.current.generation++;
    opening.current.controller?.abort();
  }, []);

  useEffect(() => {
    if (data) {
      setHiddenIds(val => val.filter(id => data.items.some(item => item.id === id)));
    }
  }, [data]);

  const refresh = () => {
    collection.refresh();
    notifyNotesChanged();
  };

  // Strictly limit to maximum 4 slots
  const pinnedNotes = (data?.items ?? [])
    .filter(note => note.is_pinned && !note.is_archived && !hiddenIds.includes(note.id))
    .slice(0, 4);

  const open = async (note: NoteSummary | null) => {
    opening.current.controller?.abort();
    const generation = ++opening.current.generation;
    setActionError('');

    if (!note) {
      setActionBusy(false);
      setSelectedNote(null);
      setIsModalOpen(true);
      return;
    }

    const controller = new AbortController();
    opening.current.controller = controller;
    setActionBusy(true);

    try {
      const value = await notesApi.get(note.id, controller.signal);
      if (opening.current.generation === generation && !controller.signal.aborted) {
        setSelectedNote(value);
        setIsModalOpen(true);
      }
    } catch (reason) {
      if (opening.current.generation === generation && !controller.signal.aborted) {
        setActionError(reason instanceof Error ? reason.message : 'Không mở được ghi chú.');
      }
    } finally {
      if (opening.current.generation === generation) setActionBusy(false);
    }
  };

  const close = () => {
    opening.current.generation++;
    opening.current.controller?.abort();
    setIsModalOpen(false);
  };

  const saveNote = async (payload: NoteWrite, attempt?: NoteCreateAttempt, targetId?: string) => {
    if (selectedNote?.id) {
      await notesApi.updateNote(targetId ?? selectedNote.id, {
        ...payload,
        expected_version: payload.expected_version ?? selectedNote.version,
      });
    } else {
      if (!attempt) throw new Error('Thiếu mã yêu cầu tạo ghi chú.');
      await createNoteWithRetry(payload, attempt);
    }
    refresh();
  };

  const deleteNote = async (id: string, verifyOnly = false, expectedVersion?: number) => {
    await deleteNoteWithRecovery(id, verifyOnly, expectedVersion);
    setHiddenIds(value => [...value, id]);
    refresh();
  };

  const archiveNote = async (id: string, expectedVersion: number, payload: NoteWrite) => {
    await notesApi.updateNote(id, { ...payload, is_archived: true, expected_version: expectedVersion });
    setHiddenIds(value => [...value, id]);
    refresh();
  };

  const change = async (note: NoteSummary, payload: Partial<Note>) => {
    if (actionBusy) return;
    setActionBusy(true);
    setActionError('');
    try {
      await notesApi.updateNote(note.id, { ...payload, expected_version: note.version });
      if (payload.is_pinned === false || payload.is_archived) {
        setHiddenIds(value => [...value, note.id]);
      }
      refresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Không lưu được ghi chú.');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <section className="glass-panel widget-box pinned-notes-widget" aria-label="Ghi chú đã ghim">
      <div className="widget-header">
        <div className="widget-title">
          <Pin size={16} className="widget-title-icon" />
          <span>Ghi chú đã ghim</span>
        </div>
        {onOpenAll && (
          <button
            type="button"
            className="workspace-text-link"
            title="Xem tất cả trong DT My Note"
            onClick={onOpenAll}
          >
            <span>Xem tất cả</span>
            <ArrowUpRight size={13} />
          </button>
        )}
      </div>

      {(actionError || collection.error) && (
        <div className="alert-error" role="alert">
          {actionError || collection.error}
          <button type="button" onClick={() => collection.refresh()}>Thử lại</button>
        </div>
      )}

      {loading && !pinnedNotes.length ? (
        <p className="notes-empty" role="status">Đang tải ghi chú đã ghim…</p>
      ) : pinnedNotes.length === 0 ? (
        <p className="notes-empty">Chưa có ghi chú nào được ghim.</p>
      ) : (
        <div className="pinned-notes-grid" aria-busy={loading}>
          {pinnedNotes.map(note => (
            <NoteCard
              key={note.id}
              note={note}
              event={note.scheduled_event}
              now={now}
              disabled={actionBusy || loading}
              onOpen={() => { void open(note); }}
              onPin={() => { void change(note, { is_pinned: !note.is_pinned }); }}
              onRestore={() => { void change(note, { is_archived: false }); }}
              onDelete={() => setDeleteTarget(note)}
            />
          ))}
        </div>
      )}

      {deleteTarget && (
        <DeleteNoteDialog
          note={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDelete={(verifyOnly, expectedVersion) => deleteNote(deleteTarget.id, verifyOnly, expectedVersion)}
        />
      )}

      {isModalOpen && (
        <NoteModal
          key={selectedNote?.id ?? 'new-pinned-note'}
          note={selectedNote ?? ({ is_pinned: true } as Note)}
          isOpen
          onClose={close}
          onSave={saveNote}
          onDelete={deleteNote}
          onArchive={archiveNote}
        />
      )}
    </section>
  );
}

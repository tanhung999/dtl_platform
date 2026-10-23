import { useEffect, useRef, useState } from 'react';
import { Note } from '../../types';
import { NoteModal } from '../notes/NoteModal';
import { notesApi, notifyNotesChanged } from '../notes/api';
import { deleteNoteWithRecovery } from '../notes/deleteNote';

function LoadingNoteDialog({ error, onClose, onRetry }: { error: string; onClose: () => void; onRetry: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="note-delete-dialog" aria-label="Mở ghi chú" onCancel={event => { event.preventDefault(); event.stopPropagation(); }}>
    <p role={error ? 'alert' : 'status'}>{error || 'Đang mở ghi chú…'}</p>
    <footer>{error && <button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Thử lại</button>}<button type="button" className="task-icon-button" aria-label="Đóng mở ghi chú" onClick={onClose}>×</button></footer>
  </dialog>;
}

export function CalendarNoteModal({ noteId, occurrenceAt, onClose }: { noteId: string; occurrenceAt?: string; onClose: () => void }) {
  const [note, setNote] = useState<Note>(), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    notesApi.get(noteId, controller.signal).then(value => { if (!controller.signal.aborted) setNote(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không mở được ghi chú.'); });
    return () => controller.abort();
  }, [noteId, retry]);
  if (!note) return <LoadingNoteDialog error={error} onClose={onClose} onRetry={() => setRetry(value => value + 1)} />;
  return <NoteModal occurrenceAt={occurrenceAt} note={note} isOpen onClose={onClose}
    onSave={async (payload, _attempt, targetId) => { await notesApi.updateNote(targetId ?? note.id, { ...payload, expected_version: payload.expected_version ?? note.version }); notifyNotesChanged(); }}
    onArchive={async (id, expectedVersion, payload) => { await notesApi.updateNote(id, { ...payload, is_archived: true, expected_version: expectedVersion }); notifyNotesChanged(); }}
    onDelete={async (id, verifyOnly, expectedVersion) => { await deleteNoteWithRecovery(id, verifyOnly, expectedVersion); notifyNotesChanged(); }} />;
}

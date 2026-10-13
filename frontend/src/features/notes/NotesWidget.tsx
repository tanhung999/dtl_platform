import { useListMotion } from '../drag-feedback/useListMotion';
import React, { useEffect, useState } from 'react';
import { StickyNote, Plus, Pin, Trash2, Calendar } from 'lucide-react';
import { api } from '../../services/api';
import { Note } from '../../types';
import { NoteModal } from './NoteModal';
import { orderedItems, useWorkspaceLayout } from '../workspace-layout/WorkspaceLayoutProvider';
import { NotesPinZone, SortableWidgetCard, SortableWidgetGroup } from '../workspace-layout/SortableWidgets';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

export const NotesWidget: React.FC = () => {
  const layout = useWorkspaceLayout();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const ordered = orderedItems(notes, layout.layout.notes.ids);
  const visibleNotes = [...ordered.filter(note => note.is_pinned), ...ordered.filter(note => !note.is_pinned)];

  const list = useListMotion(visibleNotes.map(item => item.id), 'data-sort-id');
  const fetchNotes = async () => {
    setLoading(true);
    try {
      const data = await api.getNotes();
      setNotes(data);
    } catch (err) {
      console.error('Lỗi tải ghi chú:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotes();
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('notes')) fetchNotes(); };
    window.addEventListener(WORKSPACE_CHANGED, changed);
    return () => window.removeEventListener(WORKSPACE_CHANGED, changed);
  }, []);

  const handleSave = async (payload: { title: string; content: string; color: string; is_pinned: boolean }) => {
    try {
      if (selectedNote) {
        await api.updateNote(selectedNote.id, payload);
      } else {
        await api.createNote(payload);
      }
      fetchNotes();
    } catch (err) {
      console.error('Lỗi lưu ghi chú:', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteNote(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error('Lỗi xóa ghi chú:', err);
    }
  };

  return (
    <div className="glass-panel widget-box">
      <div className="widget-header">
        <div className="widget-title">
          <StickyNote size={18} className="widget-title-icon" />
          <span>Ghi Chú Nhanh (Notes)</span>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setSelectedNote(null);
            setIsModalOpen(true);
          }}
          title="Tạo ghi chú mới"
        >
          <Plus size={14} />
          <span>Thêm</span>
        </button>
      </div>

      {actionError && <p role="alert" className="alert-error">{actionError}</p>}
      {loading && notes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8', fontSize: '0.85rem' }}>
          Đang tải ghi chú...
        </div>
      ) : notes.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem 1rem',
            color: '#94a3b8',
            fontSize: '0.85rem',
            border: '2px dashed #e2e8f0',
            borderRadius: '10px',
          }}
        >
          Chưa có ghi chú nào. Bấm <strong>Thêm</strong> để tạo ghi chú đầu tiên!
        </div>
      ) : (
        <SortableWidgetGroup revision={layout.layout.notes.version} ids={visibleNotes.map(note => note.id)} disabled={layout.busy || layout.loading} pinned={Object.fromEntries(notes.map(note => [note.id, note.is_pinned]))} onSort={async (ids, activeId, pin, restorePin) => { await layout.save('notes', ids, restorePin !== undefined ? { [activeId]: restorePin } : pin ? { [activeId]: true } : {}); if (pin || restorePin !== undefined) await fetchNotes(); }}><div data-sort-group="notes"><NotesPinZone disabled={layout.busy || layout.loading} /><div className="notes-grid" ref={list}>
          {visibleNotes.map((note) => (
            <SortableWidgetCard id={note.id} label={note.title} disabled={layout.busy || layout.loading}
              key={note.id}
              className={`note-card ${note.is_pinned ? 'pinned' : ''}`}
              style={{ backgroundColor: note.color || '#fef08a' }}
              onClick={() => {
                setSelectedNote(note);
                setIsModalOpen(true);
              }}
            >
              {note.is_pinned && (
                <div className="note-pin-badge" title="Đã ghim">
                  <Pin size={13} />
                </div>
              )}
              <div>
                <h4 className="note-title">{note.title}</h4>
                <p className="note-content">{note.content || '...'}</p>
              </div>

              <div className="note-footer">
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Calendar size={11} />
                  {new Date(note.updated_at).toLocaleDateString('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </span>
                <button type="button" className="task-icon-button" title={note.is_pinned ? 'Bỏ ghim' : 'Ghim'} aria-label={`${note.is_pinned ? 'Bỏ ghim' : 'Ghim'} ${note.title}`} onClick={async event => { event.stopPropagation(); setActionError(''); try { await api.updateNote(note.id, { is_pinned: !note.is_pinned }); await fetchNotes(); } catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Không thể đổi trạng thái ghim.'); } }}><Pin size={13} /></button>
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#64748b',
                    padding: '2px',
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(note.id);
                  }}
                  title="Xóa ghi chú"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </SortableWidgetCard>
          ))}
        </div></div></SortableWidgetGroup>
      )}

      <NoteModal
        note={selectedNote}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
      />
    </div>
  );
};

import { CSSProperties } from 'react';
import { Calendar, Clock, Pin, RotateCcw, Trash2 } from 'lucide-react';
import { NoteSummary } from './types';
import { shortNoteDate } from './noteView';
import { ScheduledEvent } from './types';
import { SortableWidgetCard } from '../workspace-layout/SortableWidgets';
interface Props {
  note: NoteSummary; event: ScheduledEvent | null; now: Date; group: string; disabled: boolean;
  onOpen: () => void; onPin: () => void; onDelete: () => void; onRestore: () => void;
}
export function NoteCard({ note, event, now, group, disabled, onOpen, onPin, onDelete, onRestore }: Props) {
  const next = event;
  const ended = next && Date.parse(next.ends_at) <= now.getTime();
  const created = shortNoteDate(note.created_at);
  const eventDate = next && shortNoteDate(next.starts_at);
  return <SortableWidgetCard group={group} id={note.id} label={note.title} disabled={disabled || note.is_archived}
    className={`note-card ${note.is_pinned ? 'pinned' : ''} ${note.is_archived ? 'is-archived' : ''}`}
    style={{ '--note-color': note.color || '#fef08a' } as CSSProperties} onClick={onOpen}>
    {note.is_pinned && <div className="note-pin-badge" title="Đã ghim"><Pin size={13} /></div>}
    <div><h4 className="note-title">{note.title}</h4><p className="note-content">{note.preview || '...'}</p></div>
    <div className="note-footer">
      {next ? <button type="button" className={`note-event-summary ${ended ? 'is-past' : ''}`} title={`Lịch hẹn: ${next.title}`} onClick={e => { e.stopPropagation(); onOpen(); }}><Calendar size={12} /><span className="note-event-name">{next.title}</span><span className="note-event-date">· {eventDate}</span></button>
        : <span className="note-created-date" title="Ngày tạo ghi chú"><Clock size={11} />{created}</span>}
      <span className="note-card-actions">
        {note.is_archived ? <button type="button" className="task-icon-button" title="Khôi phục ghi chú" aria-label={`Khôi phục ${note.title}`} disabled={disabled} onClick={e => { e.stopPropagation(); onRestore(); }}><RotateCcw size={13} /></button>
          : <button type="button" className="task-icon-button" title={note.is_pinned ? 'Bỏ ghim' : 'Ghim'} aria-label={`${note.is_pinned ? 'Bỏ ghim' : 'Ghim'} ${note.title}`} disabled={disabled} onClick={e => { e.stopPropagation(); onPin(); }}><Pin size={13} /></button>}
        <button type="button" className="task-icon-button" title="Xóa ghi chú" aria-label={`Xóa ${note.title}`} disabled={disabled} onClick={e => { e.stopPropagation(); onDelete(); }}><Trash2 size={13} /></button>
      </span>
    </div>
  </SortableWidgetCard>;
}

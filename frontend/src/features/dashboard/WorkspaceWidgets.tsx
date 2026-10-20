import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { TasksWidget } from '../tasks/TasksWidget';
import { NotesWidget } from '../notes/NotesWidget';
import { NoteFilter } from '../notes/noteView';
import { CalendarWidget } from '../calendar/CalendarWidget';
import './dashboard.css';

export function WorkspaceWidgets({ onOpenCalendar, onOpenNotes, onOpenTasks }: { onOpenCalendar: (date: Date) => void; onOpenNotes: (filter: NoteFilter) => void; onOpenTasks: () => void }) {
  return <div className="dashboard-grid">
    <section className="col-launcher dashboard-column" aria-label="Ứng dụng và liên kết"><AppLauncherWidget /><BookmarksWidget /></section>
    <section className="col-tasks dashboard-column" aria-label="Việc cần làm"><TasksWidget onOpenAll={onOpenTasks} /></section>
    <section className="col-notes dashboard-column" aria-label="Lịch và ghi chú"><CalendarWidget onOpenCalendar={onOpenCalendar} /><NotesWidget onOpenAll={onOpenNotes} /></section>
  </div>;
}

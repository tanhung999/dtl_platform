import { CSSProperties, useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckSquare, Clock, LoaderCircle, Plus, StickyNote, X } from 'lucide-react';
import { useLatestRequest } from '../../../services/useLatestRequest';
import { addDays, dateKey, eventDayLabel, formatDate, toTimestamp } from '../dateUtils';
import { calendarDayGroups } from '../dayGroups';
import { CalendarEvent, EventDraft } from '../types';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useTaskRange } from '../../tasks/useTaskRange';
import { useTasks } from '../../tasks/context/TasksContext';
import { deadlineLabel, isOverdue } from '../../tasks/deadlineUtils';
import { PriorityIcon } from '../../tasks/components/PriorityIcon';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';
import { CalendarItemTitle } from './CalendarItemTitle';

interface Props {
  day: Date;
  showEvents: boolean;
  showNotes: boolean;
  showTasks: boolean;
  onClose: () => void;
  onCreate: (draft: EventDraft) => void;
  onSelect: (event: CalendarEvent, day: string, signal: AbortSignal) => Promise<void>;
}

function OpeningFeedback({ pending, error }: { pending: boolean; error?: string }) {
  if (pending) return <span className="calendar-day-opening" role="status"><LoaderCircle size={13} className="calendar-spin" />Đang mở chi tiết…</span>;
  if (error) return <span className="calendar-day-opening is-error" role="alert">{error} Bấm lại mục này để thử lại.</span>;
  return null;
}

export function DayItemsDialog({ day, showEvents, showNotes, showTasks, onClose, onCreate, onSelect }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opening = useLatestRequest();
  const pendingId = useRef<string>();
  const [openingState, setOpeningState] = useState<{ id: string; pending: boolean; error?: string }>();
  const close = () => { opening.cancel(); pendingId.current = undefined; onClose(); };
  const open = async (id: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (pendingId.current === id) return;
    const controller = opening.start();
    pendingId.current = id;
    setOpeningState({ id, pending: true });
    try { await action(controller.signal); }
    catch (reason) {
      if (!controller.signal.aborted) setOpeningState({ id, pending: false, error: reason instanceof Error ? reason.message : 'Không mở được chi tiết.' });
    }
    finally {
      if (!controller.signal.aborted) {
        pendingId.current = undefined;
        setOpeningState(value => value?.id === id ? { ...value, pending: false } : value);
      }
    }
  };
  const key = dateKey(day), end = addDays(day, 1);
  const events = useCalendarEvents(toTimestamp(day), toTimestamp(end), showEvents, showNotes);
  const deadlines = useTaskRange(key, dateKey(end), showTasks);
  const tasks = useTasks();
  const group = calendarDayGroups(events.events, deadlines.tasks, day, 1)[0];
  const sections = [
    { name: 'Sự kiện', enabled: showEvents, kind: 'event', Icon: CalendarDays, items: group.events.filter(item => !item.scheduled_note_id), total: events.eventTotal },
    { name: 'Ghi chú', enabled: showNotes, kind: 'note', Icon: StickyNote, items: group.events.filter(item => !!item.scheduled_note_id), total: events.noteTotal },
  ];
  const loading = events.loading || deadlines.loading;
  const empty = !group.events.length && !group.tasks.length;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="calendar-day-dialog" aria-labelledby="calendar-day-dialog-title"
    onCancel={event => { event.preventDefault(); close(); }}>
    <header className="calendar-day-dialog-header">
      <div><p>Lịch trong ngày</p><h2 id="calendar-day-dialog-title">{formatDate(day, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</h2></div>
      <button type="button" className="calendar-icon-button" aria-label="Đóng danh sách trong ngày" onClick={close}><X size={20} /></button>
    </header>
    <div className="calendar-day-dialog-body" aria-busy={loading}>

      {loading && <p role="status" className="calendar-day-feedback">Đang tải lịch trong ngày…</p>}
      {(events.error || deadlines.error) && <div className="calendar-error-state" role="alert"><p>{events.error || deadlines.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={() => { events.refresh(); tasks.refresh(); }}>Thử lại</button></div>}
      {sections.filter(section => section.enabled).map(({ name, kind, Icon, items, total }) => <section className={`calendar-day-section is-${kind}`} key={kind} aria-label={name}>
        <h3><Icon size={17} />{name}<span>{total}</span></h3>
        {items.map(item => <button type="button" className="calendar-day-item" key={item.id} style={{ '--event-color': eventStatus(item, tasks.now, key).color } as CSSProperties}
          aria-busy={openingState?.id === item.id && openingState.pending} aria-disabled={openingState?.id === item.id && openingState.pending}
          onClick={() => { void open(item.id, signal => onSelect(item, key, signal)); }}>
          <strong><CalendarItemTitle event={item} /></strong>
          <span className="calendar-day-item-meta"><span><Clock size={13} />{eventDayLabel(item, key)}</span><EventStatusBadge status={eventStatus(item, tasks.now, key)} /></span>
          {item.location && <span className="calendar-day-location">{item.location}</span>}
          <OpeningFeedback pending={openingState?.id === item.id && openingState.pending} error={openingState?.id === item.id ? openingState.error : undefined} />
        </button>)}
        {!items.length && !events.loading && !events.error && <p className="calendar-day-feedback">Không có {name.toLocaleLowerCase('vi')} trong ngày.</p>}
      </section>)}
      {showTasks && <section className="calendar-day-section is-task" aria-label="Công việc">
        <h3><CheckSquare size={17} />Công việc<span>{deadlines.total}</span></h3>
        {group.tasks.map(task => <button type="button" className={`calendar-day-item ${task.is_completed ? 'is-completed' : ''}`} key={task.id} data-task-priority={task.priority}
          aria-busy={openingState?.id === task.id && openingState.pending} aria-disabled={openingState?.id === task.id && openingState.pending}
          onClick={() => { void open(task.id, signal => tasks.openTask(task.id, signal)); }}>
          <strong><PriorityIcon priority={task.priority} /><span className="calendar-day-task-title">{task.title}</span></strong>
          <span className="calendar-day-item-meta"><span><Clock size={13} />{deadlineLabel(task, false, false) || 'Hạn cả ngày'}</span>
            <span className={!task.is_completed && isOverdue(task, tasks.now) ? 'calendar-day-overdue' : ''}>{task.is_completed ? 'Đã hoàn thành' : isOverdue(task, tasks.now) ? 'Quá hạn' : 'Chưa hoàn thành'}</span></span>
          <OpeningFeedback pending={openingState?.id === task.id && openingState.pending} error={openingState?.id === task.id ? openingState.error : undefined} />
        </button>)}
        {!group.tasks.length && !deadlines.loading && !deadlines.error && <p className="calendar-day-feedback">Không có công việc đến hạn trong ngày.</p>}
      </section>}
      {empty && !loading && !events.error && !deadlines.error && <p className="calendar-day-empty">Ngày này chưa có mục nào phù hợp với bộ lọc.</p>}
      {(events.truncated || deadlines.truncated) && <div className="calendar-day-load-more">
        {events.truncated && <button type="button" className="btn btn-outline btn-sm" disabled={events.loading} onClick={() => { void events.loadMore(); }}>Tải thêm sự kiện / ghi chú</button>}
        {deadlines.truncated && <button type="button" className="btn btn-outline btn-sm" disabled={deadlines.loading} onClick={() => { void deadlines.loadMore(); }}>Tải thêm công việc</button>}
      </div>}
    </div>
    <footer><button type="button" className="btn btn-primary btn-sm" onClick={() => { close(); onCreate({ date: day }); }}><Plus size={16} />Tạo sự kiện</button></footer>
  </dialog>;
}

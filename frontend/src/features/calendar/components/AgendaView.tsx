import { CalendarItemTitle, calendarItemType } from './CalendarItemTitle';
import { CalendarDays, MapPin, Plus } from 'lucide-react';
import { CSSProperties } from 'react';
import { CalendarViewProps } from '../types';
import { addDays, dateKey, eventLabel, eventDayLabel, eventsOnDay, formatDate, today } from '../dateUtils';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';

export function AgendaView({ anchor, events, tasks, onCreate, onSelect }: CalendarViewProps) {
  const { now } = useTasks();
  const days = Array.from({ length: 30 }, (_, i) => addDays(anchor, i));
  const occupied = days.filter(day => eventsOnDay(events, day).length > 0 || tasks.some(task => task.due_date === dateKey(day)));
  const todayKey = dateKey(today());
  if (!occupied.length) return <div className="calendar-empty calendar-agenda-empty">
    <CalendarDays size={38} /><h3>Lịch của bạn đang trống</h3><p>Chưa có sự kiện hoặc hạn công việc trong 30 ngày từ {formatDate(anchor)}.</p>
    <button type="button" className="btn btn-primary" onClick={() => onCreate({ date: anchor })}><Plus size={16} /> Tạo sự kiện đầu tiên</button>
  </div>;

  return <div className="calendar-agenda">
    {occupied.map(day => <section className="calendar-agenda-day" key={dateKey(day)} aria-label={formatDate(day, { dateStyle: 'full' })}>
      <div className={`calendar-agenda-date ${dateKey(day) === todayKey ? 'is-today' : ''}`}><strong>{day.getUTCDate()}</strong><span>{formatDate(day, { weekday: 'short', month: 'short' })}</span></div>
      <div className="calendar-agenda-events">{tasks.filter(task => task.due_date === dateKey(day)).map(task => <DeadlineRow key={task.id} task={task} />)}{eventsOnDay(events, day).map(event => {
        const status = eventStatus(event, now, dateKey(day));
        return <button type="button" className={`calendar-agenda-event ${event.scheduled_note_id ? 'is-note' : ''}`} title={`${calendarItemType(event)} · ${event.title} · ${eventLabel(event)}`} key={event.id} data-event-id={event.id} data-event-status={status.key}
        style={{ '--event-color': status.color } as CSSProperties} onClick={() => onSelect(event, dateKey(day))}>
        <span className="calendar-agenda-info"><strong><CalendarItemTitle event={event} /></strong><EventStatusBadge status={status} /><span className="calendar-agenda-time">{eventDayLabel(event, dateKey(day))}</span>{event.location && <span><MapPin size={13} /> {event.location}</span>}</span>
      </button>; })}</div>
    </section>)}
  </div>;
}

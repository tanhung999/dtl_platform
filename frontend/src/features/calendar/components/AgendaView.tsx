import { useMemo, useRef } from 'react';
import { calendarDayGroups } from '../dayGroups';
import { useScrollMemory } from '../../../services/viewMemory';
import { eventTooltip } from '../itemTooltip';
import { CalendarItemTitle } from './CalendarItemTitle';
import { CalendarDays, MapPin, Plus } from 'lucide-react';
import { CSSProperties } from 'react';
import { CalendarViewProps } from '../types';
import { dateKey, eventDayLabel, formatDate, today } from '../dateUtils';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';

export function AgendaView({ anchor, events, tasks, onCreate, onSelect }: CalendarViewProps) {
  const { now } = useTasks();
  const scroll = useRef<HTMLDivElement>(null);
  useScrollMemory(scroll, `calendar/agenda/${dateKey(anchor)}`);
  const anchorKey = dateKey(anchor);
  const occupied = useMemo(() => calendarDayGroups(events, tasks, anchor, 30).filter(group => group.events.length || group.tasks.length), [events, tasks, anchorKey]);
  const todayKey = dateKey(today());
  if (!occupied.length) return <div ref={scroll} className="calendar-empty calendar-agenda-empty">
    <CalendarDays size={38} /><h3>Không có mục nào hiển thị</h3><p>Không có mục phù hợp với bộ lọc trong 30 ngày từ {formatDate(anchor)}. Bạn có thể bật lại Sự kiện, Công việc hoặc Ghi chú để kiểm tra.</p>
    <button type="button" className="btn btn-primary" onClick={() => onCreate({ date: anchor })}><Plus size={16} /> Tạo sự kiện</button>
  </div>;

  return <div className="calendar-agenda" ref={scroll}>
    {occupied.map(({ day, events: dayEvents, tasks: dayTasks }) => <section className="calendar-agenda-day" key={dateKey(day)} aria-label={formatDate(day, { dateStyle: 'full' })}>
      <div className={`calendar-agenda-date ${dateKey(day) === todayKey ? 'is-today' : ''}`}><strong>{day.getUTCDate()}</strong><span>{formatDate(day, { weekday: 'short', month: 'short' })}</span></div>
      <div className="calendar-agenda-events">{dayTasks.map(task => <DeadlineRow key={task.id} task={task} />)}{dayEvents.map(event => {
        const status = eventStatus(event, now, dateKey(day));
        return <button type="button" className={`calendar-agenda-event ${event.scheduled_note_id ? 'is-note' : ''}`} data-tooltip={eventTooltip(event, now)} key={event.id} data-event-id={event.id} data-event-status={status.key}
        style={{ '--event-color': status.color } as CSSProperties} onClick={() => onSelect(event, dateKey(day))}>
        <span className="calendar-agenda-info"><strong><CalendarItemTitle event={event} /></strong><EventStatusBadge status={status} /><span className="calendar-agenda-time">{eventDayLabel(event, dateKey(day))}</span>{event.location && <span><MapPin size={13} /> {event.location}</span>}</span>
      </button>; })}</div>
    </section>)}
  </div>;
}

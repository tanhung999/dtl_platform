import { CalendarViewProps } from '../types';
import { dateKey, eventsOnDay, formatDate, monthDays, today, WEEKDAYS } from '../dateUtils';
import { EventButton } from './EventButton';
import { DeadlineRow } from './DeadlineRow';
import { CalendarDeadlineDropZone } from '../../task-calendar/CalendarDeadlineDropZone';

interface Props extends CalendarViewProps { onShowDay: (date: Date) => void }

export function MonthView({ anchor, events, tasks, onCreate, onSelect, onShowDay }: Props) {
  const todayKey = dateKey(today());
  return (
    <div className="calendar-month-scroll">
      <div className="calendar-month">
        <div className="calendar-month-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div>
        <div className="calendar-month-grid">
          {monthDays(anchor).map(day => {
            const dayEvents = eventsOnDay(events, day);
            const deadlines = tasks.filter(task => task.due_date === dateKey(day));
            const remaining = Math.max(0, 3 - deadlines.length);
            const extra = deadlines.length + dayEvents.length - 3;
            return <CalendarDeadlineDropZone key={dateKey(day)} target={{ type: 'calendar-day', date: dateKey(day) }} className={`calendar-month-cell ${day.getUTCMonth() !== anchor.getUTCMonth() ? 'is-outside' : ''}`}>
              <button type="button" className={`calendar-day-number ${dateKey(day) === todayKey ? 'is-today' : ''}`} aria-label={`Tạo lịch ${formatDate(day, { dateStyle: 'full' })}`} onClick={() => onCreate({ date: day })}>{day.getUTCDate()}</button>
              <div className="calendar-month-events">
                {deadlines.slice(0, 3).map(task => <DeadlineRow key={task.id} task={task} />)}
                {dayEvents.slice(0, remaining).map(event => <EventButton key={event.id} event={event} day={dateKey(day)} compact onSelect={onSelect} />)}
                {extra > 0 && <button type="button" className="calendar-more" onClick={() => onShowDay(day)}>+{extra} mục khác</button>}
              </div>
              <button className="calendar-cell-create" type="button" aria-label={`Thêm sự kiện ngày ${formatDate(day)}`} onClick={() => onCreate({ date: day })} />
            </CalendarDeadlineDropZone>;
          })}
        </div>
      </div>
    </div>
  );
}

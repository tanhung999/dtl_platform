import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, addMonths, dateKey, eventsOnDay, formatDate, monthDays, startOfWeek, today, WEEKDAYS } from '../dateUtils';
import { CalendarEvent } from '../types';
import { Task } from '../../../types';
import { useTasks } from '../../tasks/context/TasksContext';
import { isOverdue } from '../../tasks/deadlineUtils';
import { CalendarDays } from '../types';

interface Props {
  month: Date;
  selected: Date;
  onMonthChange: (date: Date) => void;
  onSelect: (date: Date) => void;
  events: CalendarEvent[];
  tasks: Task[];
  highlightWeek: boolean;
  counts?: CalendarDays; showEvents?: boolean; showTasks?: boolean; showNotes?: boolean;
}

export function MiniCalendar({ month, selected, onMonthChange, onSelect, events, tasks, highlightWeek, counts, showEvents = true, showTasks = true, showNotes = true }: Props) {
  const { now } = useTasks();
  const todayKey = dateKey(today());
  const weekStart = dateKey(startOfWeek(selected));
  const weekEnd = dateKey(addDays(startOfWeek(selected), 7));
  return (
    <div className="calendar-mini">
      <div className="calendar-mini-heading">
        <strong>{formatDate(month, { month: 'long', year: 'numeric' })}</strong>
        <div className="calendar-inline-actions">
          <button type="button" className="calendar-icon-button" aria-label="Tháng trước" onClick={() => onMonthChange(addMonths(month, -1))}><ChevronLeft size={16} /></button>
          <button type="button" className="calendar-icon-button" aria-label="Tháng sau" onClick={() => onMonthChange(addMonths(month, 1))}><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="calendar-mini-grid">
        {WEEKDAYS.map(day => <span className="calendar-mini-weekday" key={day}>{day}</span>)}
        {monthDays(month).map(day => {
          const key = dateKey(day), dayTasks = tasks.filter(task => task.due_date === key);
          const hasItems = counts ? (showTasks && counts[key]?.tasks > 0) || (showEvents && counts[key]?.events > 0) || (showNotes && counts[key]?.notes > 0) : (showTasks && dayTasks.length > 0) || eventsOnDay(events, day).some(event => event.scheduled_note_id ? showNotes : showEvents);
          const urgent = counts ? showTasks && counts[key]?.attention : showTasks && dayTasks.some(task => !task.is_completed && (task.priority === 'URGENT' || isOverdue(task, now)));
          return (
          <button key={dateKey(day)} type="button" onClick={() => onSelect(day)}
            aria-label={formatDate(day, { dateStyle: 'full' })} aria-pressed={dateKey(day) === dateKey(selected)}
            data-date={key} aria-description={hasItems ? 'Có sự kiện, ghi chú hoặc công việc' : undefined} className={`${day.getUTCMonth() !== month.getUTCMonth() ? 'is-outside' : ''} ${dateKey(day) === todayKey ? 'is-today' : ''} ${dateKey(day) === dateKey(selected) ? 'is-selected' : ''} ${highlightWeek && key >= weekStart && key < weekEnd ? 'is-viewed-week' : ''}`}>
            {day.getUTCDate()}{hasItems && <span className={`calendar-mini-day-dot ${urgent ? 'needs-attention' : ''}`} aria-hidden="true" />}
          </button>
        ); })}
      </div>
    </div>
  );
}

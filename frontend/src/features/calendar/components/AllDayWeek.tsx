import { AllDayEventBar } from './AllDayEventBar';
import { CalendarViewProps } from '../types';
import { addDays, dateKey, formatDate, startOfWeek } from '../dateUtils';
import { allDayPlacements } from '../allDayPlacements';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';
import { vietnamDay } from '../../tasks/deadlineUtils';

interface Props extends CalendarViewProps { onShowDay: (date: Date) => void; }

export function AllDayWeek({ anchor, events, tasks, onCreate, onSelect, onShowDay }: Props) {
  const { now } = useTasks();
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const items = allDayPlacements(events, tasks, anchor);
  const rows = Math.max(1, Math.min(4, items.reduce((max, item) => Math.max(max, item.lane + 1), 0)));
  return <div className="calendar-week-all-day" style={{ gridTemplateRows: `repeat(${rows}, 32px) 26px`, rowGap: 4 }}>
    <span className="calendar-zone" style={{ gridColumn: 1, gridRow: `1 / span ${rows + 1}` }}>Cả ngày</span>
    {days.map((day, index) => <div key={dateKey(day)} data-date={dateKey(day)} className={`calendar-all-day-background ${dateKey(day) === vietnamDay(now) ? 'is-today' : ''}`} style={{ gridColumn: index + 2, gridRow: `1 / span ${rows + 1}` }} />)}
    {items.filter(item => item.lane < 4).map(item => {
      const style = { gridColumn: `${item.start + 2} / span ${item.end - item.start + 1}`, gridRow: item.lane + 1 };
      if (item.kind === 'deadline') return <div key={`task-${item.task.id}`} className="calendar-all-day-cell calendar-all-day-placement" style={style}><DeadlineRow task={item.task} /></div>;
      const covered = days.slice(item.start, item.end + 1);
      const representative = covered.find(day => dateKey(day) === dateKey(anchor)) || covered[0];
      return <AllDayEventBar key={`event-${item.event.id}`} event={item.event} covered={covered} representative={representative} weekStart={days[0]} style={style} onSelect={onSelect} />;
    })}
    {days.map((day, index) => {
      const extra = items.filter(item => item.lane >= 4 && item.start <= index && item.end >= index).length;
      return <div key={dateKey(day)} className="calendar-all-day-footer" style={{ gridColumn: index + 2, gridRow: rows + 1 }}>{extra > 0 && <button type="button" className="calendar-more" onClick={() => onShowDay(day)}>+{extra} mục</button>}<button type="button" className="calendar-all-day-add" aria-label={`Tạo sự kiện cả ngày ${formatDate(day)}`} onClick={() => onCreate({ date: day, allDay: true })}>+</button></div>;
    })}
  </div>;
}

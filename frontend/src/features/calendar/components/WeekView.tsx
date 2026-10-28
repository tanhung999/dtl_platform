import { useScrollMemory } from '../../../services/viewMemory';
import { useMemo } from 'react';
import { useCalendarTimeline } from '../useCalendarTimeline';
import { CalendarViewProps } from '../types';
import { addDays, dateKey, eventTime, formatDate, MIN_EVENT_HEIGHT, startOfWeek, today, WEEKDAYS } from '../dateUtils';
import { DEADLINE_MARKER_HEIGHT, weekTimedPlacements } from '../deadlinePlacements';
import { AllDayWeek } from './AllDayWeek';
import { EventButton } from './EventButton';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';

interface Props extends CalendarViewProps { onShowDay: (date: Date) => void; showEarlyHours: boolean; }

export function WeekView({ anchor, events, tasks, onCreate, onSelect, onShowDay, showEarlyHours }: Props) {
  const { now } = useTasks();
  const scroll = useCalendarTimeline();
  const startMinute = showEarlyHours ? 0 : 360;
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = dateKey(today());
  const currentTime = eventTime(now.toISOString()).split(':').map(Number);
  const currentMinute = currentTime[0] * 60 + currentTime[1];
  const weekKey = dateKey(weekStart);
  const placements = useMemo(() => Array.from({ length: 7 }, (_, i) => weekTimedPlacements(events, tasks, addDays(startOfWeek(anchor), i), startMinute)), [events, tasks, weekKey, startMinute]);

  useScrollMemory(scroll, `calendar/week/${weekKey}/${startMinute}`, 8 * 60 - startMinute);

  return (
    <div className="calendar-week-scroll">
      <div className="calendar-week">
        <div className="calendar-week-header">
          <span className="calendar-zone">GMT+7</span>
          {days.map((day, index) => <div key={dateKey(day)} className={`calendar-week-day ${dateKey(day) === todayKey ? 'is-today' : ''}`}>
            <span>{WEEKDAYS[index]}</span><button type="button" aria-label={`Xem lịch ${formatDate(day, { dateStyle: 'full' })}`} onClick={() => onShowDay(day)}>{day.getUTCDate()}</button>
          </div>)}
        </div>
        <AllDayWeek anchor={anchor} events={events} tasks={tasks} onCreate={onCreate} onSelect={onSelect} onShowDay={onShowDay} />
        <div className="calendar-timeline-scroll" ref={scroll}><div className="calendar-week-timeline" style={{ height: 1440 - startMinute + MIN_EVENT_HEIGHT }}>
          <div className="calendar-hours">{Array.from({ length: 24 - startMinute / 60 }, (_, i) => i + startMinute / 60).map(hour => <div key={hour}>{String(hour).padStart(2, '0')}:00</div>)}</div>
          {days.map((day, index) => <div className={`calendar-time-column ${dateKey(day) === todayKey ? 'is-today' : ''}`} key={dateKey(day)} data-date={dateKey(day)} style={{ height: 1440 - startMinute + MIN_EVENT_HEIGHT }}>
            {Array.from({ length: 24 - startMinute / 60 }, (_, i) => i + startMinute / 60).map(hour => <button type="button" key={hour} className="calendar-time-slot" aria-label={`Tạo lịch ${formatDate(day)} lúc ${hour}:00`} onClick={() => onCreate({ date: day, hour })} />)}
            {placements[index].map(item => {
              const height = item.kind === 'deadline' ? DEADLINE_MARKER_HEIGHT : Math.max(MIN_EVENT_HEIGHT, item.end - item.start);
              const span = item.laneSpan ?? 1;
              // Keep the start aligned to the grid; separate cards at the end only.
              const style = { position: 'absolute' as const, top: `${item.start - startMinute}px`, height: `${height - 3}px`, left: `${item.lane / item.lanes * 100}%`, width: `calc(${100 * span / item.lanes}% - 4px)` };
              return item.kind === 'event'
                ? <EventButton key={`event-${item.event.id}`} event={item.event} day={dateKey(day)} onSelect={onSelect} style={style} startMinute={startMinute} narrow={span / item.lanes < .6} />
                : <div key={`deadline-${item.task.id}`} className="calendar-timed-deadline" style={style}><DeadlineRow task={item.task} /></div>;
            })}
            {dateKey(day) === todayKey && currentMinute >= startMinute && <div className="calendar-now-line" style={{ top: currentMinute - startMinute }}><span /></div>}
          </div>)}
        </div></div>
      </div>
    </div>
  );
}

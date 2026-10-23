import { eventTooltip } from '../itemTooltip';
import { CalendarItemTitle } from './CalendarItemTitle';
import { CSSProperties } from 'react';
import { CalendarEvent } from '../types';
import { addDays, dateKey, toTimestamp } from '../dateUtils';
import { eventStatus } from '../eventStatus';
import { useTasks } from '../../tasks/context/TasksContext';

export function AllDayEventBar({ event, covered, representative, weekStart, style, onSelect }: { event: CalendarEvent; covered: Date[]; representative: Date; weekStart: Date; style: CSSProperties; onSelect: (event: CalendarEvent, day?: string) => void }) {
  const { now } = useTasks();
  const status = eventStatus(event, now, dateKey(representative));
  const continuesBefore = Date.parse(event.starts_at) < Date.parse(toTimestamp(weekStart));
  const continuesAfter = Date.parse(event.ends_at) > Date.parse(toTimestamp(addDays(weekStart, 7)));
  const dayAt = (x: number, node: HTMLElement) => { const box = node.getBoundingClientRect(); return covered[Math.max(0, Math.min(covered.length - 1, Math.floor((x - box.left) / box.width * covered.length)))]; };
  return <div className="calendar-all-day-event-frame" style={style}>
    <button type="button" className={`calendar-event is-compact calendar-all-day-span ${event.scheduled_note_id ? 'is-note' : ''}`} data-event-id={event.id} data-event-status={covered.length === 1 ? status.key : undefined} style={{ '--event-color': status.color } as CSSProperties}
      title={eventTooltip(event, now)}
      onClick={e => onSelect(event, dateKey(e.detail === 0 ? representative : dayAt(e.clientX, e.currentTarget)))}>
      <span className="calendar-all-day-segments" aria-hidden="true">{covered.map(day => { const segment = eventStatus(event, now, dateKey(day)); return <span key={dateKey(day)} data-event-id={covered.length > 1 ? event.id : undefined} data-event-status={segment.key} style={{ '--event-color': segment.color } as CSSProperties} />; })}</span>
      {continuesBefore && <span className="calendar-all-day-continuation" role="img" aria-label="Tiếp tục từ tuần trước">◂</span>}<span className="calendar-event-title"><CalendarItemTitle event={event} /></span><span className="calendar-event-time">Cả ngày</span>{continuesAfter && <span className="calendar-all-day-continuation" role="img" aria-label="Tiếp tục sang tuần sau">▸</span>}
    </button>
  </div>;
}

import { CSSProperties } from 'react';
import { CalendarEvent } from '../calendar/types';
import { dateKey, formatDate, toTimestamp } from '../calendar/dateUtils';
import { eventStatus } from '../calendar/eventStatus';
import { useTasks } from '../tasks/context/TasksContext';
import { EventResizeHandle, useCalendarEventDrag } from './EventDragControls';

export function AllDayEventBar({ event, covered, representative, weekStart, style, onSelect }: { event: CalendarEvent; covered: Date[]; representative: Date; weekStart: Date; style: CSSProperties; onSelect: (event: CalendarEvent, day?: string) => void }) {
  const { now } = useTasks();
  const drag = useCalendarEventDrag(event, dateKey(representative));
  const status = eventStatus(event, now, dateKey(representative));
  const continuesBefore = Date.parse(event.starts_at) < Date.parse(toTimestamp(weekStart));
  const dayAt = (x: number, node: HTMLElement) => { const box = node.getBoundingClientRect(); return covered[Math.max(0, Math.min(covered.length - 1, Math.floor((x - box.left) / box.width * covered.length)))]; };
  return <div className={`calendar-all-day-event-frame ${drag.isDragging ? 'is-dragging' : ''}`} style={style}>
    <button ref={drag.setNodeRef} data-drag-source-id={drag.dragId} type="button" {...drag.attributes} {...drag.listeners} className="calendar-event is-compact calendar-all-day-span" data-event-id={event.id} data-event-status={covered.length === 1 ? status.key : undefined} style={{ '--event-color': status.color } as CSSProperties}
      title={`${event.title} · Cả ngày${continuesBefore ? ' · Tiếp tục từ tuần trước' : ''} · ${covered.map(day => `${formatDate(day)}: ${eventStatus(event, now, dateKey(day)).label}`).join(' · ')}`}
      onMouseDown={e => { drag.data.sourceDay = dateKey(dayAt(e.clientX, e.currentTarget)); drag.listeners?.onMouseDown?.(e); }}
      onTouchStart={e => { if (e.touches[0]) drag.data.sourceDay = dateKey(dayAt(e.touches[0].clientX, e.currentTarget)); drag.listeners?.onTouchStart?.(e); }}
      onClick={e => onSelect(event, dateKey(e.detail === 0 ? representative : dayAt(e.clientX, e.currentTarget)))}>
      <span className="calendar-all-day-segments" aria-hidden="true">{covered.map(day => { const segment = eventStatus(event, now, dateKey(day)); return <span key={dateKey(day)} data-event-id={covered.length > 1 ? event.id : undefined} data-event-status={segment.key} style={{ '--event-color': segment.color } as CSSProperties} />; })}</span>
      {continuesBefore && <span className="calendar-all-day-continuation" role="img" aria-label="Tiếp tục từ tuần trước">◂</span>}<span className="calendar-event-title">{event.title}</span><span className="calendar-event-time">Cả ngày</span>
    </button><EventResizeHandle event={event} day={dateKey(covered[0])} edge="start" allDay /><EventResizeHandle event={event} day={dateKey(covered[covered.length - 1])} edge="end" allDay />
  </div>;
}

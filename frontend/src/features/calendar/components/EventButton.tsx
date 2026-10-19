import { CalendarItemTitle, calendarItemType } from './CalendarItemTitle';
import { CSSProperties } from 'react';
import { CalendarEvent } from '../types';
import { eventLabel, eventDayLabel, eventContinuation, eventContinuesNextDay } from '../dateUtils';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';
import { useTasks } from '../../tasks/context/TasksContext';
import { useEventDragState } from '../../calendar-dnd/CalendarEventDndProvider';
import { isTimedEventResize } from '../../calendar-dnd/eventSchedule';
import { EventResizeHandle, useCalendarEventDrag } from '../../calendar-dnd/EventDragControls';

interface Props {
  event: CalendarEvent;
  day: string;
  onSelect: (event: CalendarEvent, day?: string) => void;
  compact?: boolean;
  narrow?: boolean;
  startMinute?: number;
  style?: CSSProperties;
}

export function EventButton({ event, day, onSelect, compact = false, narrow = false, startMinute = 0, style }: Props) {
  const { now } = useTasks();
  const lane = style?.left !== undefined && style?.width !== undefined ? { left: String(style.left), width: String(style.width) } : undefined;
  const drag = useCalendarEventDrag(event, day, 'move', lane);
  const { active } = useEventDragState();
  const resizing = isTimedEventResize(active) && active?.event.id === event.id;
  const status = eventStatus(event, now, day);
  const short = !compact && style?.height !== undefined && parseFloat(String(style.height)) < 72;
  return (
    <div className={`calendar-event-drag-frame ${drag.isDragging ? 'is-dragging' : ''} ${resizing ? 'is-resize-source' : ''}`} style={style}><button ref={drag.setNodeRef} data-drag-source-id={drag.dragId} type="button" {...drag.attributes} {...drag.listeners} data-event-id={event.id} data-event-status={status.key} className={`calendar-event ${compact ? 'is-compact' : ''} ${short ? 'is-short' : ''} ${event.is_all_day ? 'is-all-day' : ''} ${event.scheduled_note_id ? 'is-note' : ''}`}
      style={{ '--event-color': status.color } as CSSProperties}
      onClick={() => onSelect(event, day)} title={active ? undefined : `${calendarItemType(event)} · ${event.title} · ${status.label} · ${eventLabel(event)}`}>
      <span className="calendar-event-title"><CalendarItemTitle event={event} compact={narrow || compact || short} continuation={eventContinuation(event, day, startMinute)} /></span>
      {!narrow && !short && <EventStatusBadge status={status} />}
      <span className="calendar-event-time">{eventDayLabel(event, day, narrow || compact)}</span>
      {!compact && style?.height !== undefined && eventContinuesNextDay(event, day) && <span className="calendar-event-continues-next" role="img" aria-label="Tiếp tục sang ngày sau" title="Tiếp tục sang ngày sau">↓</span>}
    </button>{!compact && style?.height !== undefined && <><EventResizeHandle event={event} day={day} edge="start" lane={lane} /><EventResizeHandle event={event} day={day} edge="end" lane={lane} /></>}</div>
  );
}

import { CSSProperties } from 'react';
import { CalendarEvent } from '../types';
import { eventLabel } from '../dateUtils';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';
import { useTasks } from '../../tasks/context/TasksContext';
import { EventResizeHandle, useCalendarEventDrag } from '../../calendar-dnd/EventDragControls';

interface Props {
  event: CalendarEvent;
  day: string;
  onSelect: (event: CalendarEvent, day?: string) => void;
  compact?: boolean;
  narrow?: boolean;
  style?: CSSProperties;
}

export function EventButton({ event, day, onSelect, compact = false, narrow = false, style }: Props) {
  const { now } = useTasks();
  const drag = useCalendarEventDrag(event, day);
  const status = eventStatus(event, now, day);
  const short = !compact && style?.height !== undefined && parseFloat(String(style.height)) < 72;
  return (
    <div className={`calendar-event-drag-frame ${drag.isDragging ? 'is-dragging' : ''}`} style={style}><button ref={drag.setNodeRef} data-drag-source-id={drag.dragId} type="button" {...drag.attributes} {...drag.listeners} data-event-id={event.id} data-event-status={status.key} className={`calendar-event ${compact ? 'is-compact' : ''} ${short ? 'is-short' : ''} ${event.is_all_day ? 'is-all-day' : ''}`}
      style={{ '--event-color': status.color } as CSSProperties}
      onClick={() => onSelect(event, day)} title={`${event.title} · ${status.label} · ${eventLabel(event)}`}>
      <span className="calendar-event-title">{event.title}</span>
      {!narrow && <EventStatusBadge status={status} />}
      <span className="calendar-event-time">{eventLabel(event)}</span>
    </button>{!compact && style?.height !== undefined && <><EventResizeHandle event={event} day={day} edge="start" /><EventResizeHandle event={event} day={day} edge="end" /></>}</div>
  );
}

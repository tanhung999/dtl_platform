import { EventContinuationMarker } from './EventContinuationMarker';
import { eventTooltip } from '../itemTooltip';
import { CalendarItemTitle } from './CalendarItemTitle';
import { CSSProperties } from 'react';
import { CalendarEvent } from '../types';
import { eventDayLabel, eventContinuation, eventContinuesNextDay } from '../dateUtils';
import { eventStatus } from '../eventStatus';
import { EventStatusBadge } from './EventStatusBadge';
import { useTasks } from '../../tasks/context/TasksContext';

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
  const status = eventStatus(event, now, day);
  const continuation = eventContinuation(event, day, startMinute);
  const timeline = !compact && style?.height !== undefined;
  const continues = timeline && eventContinuesNextDay(event, day);
  const startsBefore = timeline && Boolean(continuation);
  const short = !compact && style?.height !== undefined && parseFloat(String(style.height)) < 72;
  return (
    <div className="calendar-event-frame" style={style}><button type="button" data-event-id={event.id} data-event-status={status.key} className={`calendar-event ${compact ? 'is-compact' : ''} ${short ? 'is-short' : ''} ${event.is_all_day ? 'is-all-day' : ''} ${event.scheduled_note_id ? 'is-note' : ''} ${startsBefore || continues ? 'has-continuation' : ''} ${startsBefore ? 'has-continuation-start' : ''} ${continues ? 'has-continuation-end' : ''}`}
      style={{ '--event-color': status.color } as CSSProperties}
      onClick={() => onSelect(event, day)} data-tooltip={eventTooltip(event, now)} aria-label={eventTooltip(event, now)}>
      {startsBefore && <EventContinuationMarker direction="start" label={continuation!} />}
      <span className="calendar-event-title"><CalendarItemTitle event={event} continuation={timeline ? undefined : continuation} /></span>
      {!narrow && !short && <EventStatusBadge status={status} />}
      <span className="calendar-event-time">{eventDayLabel(event, day, narrow || compact)}</span>
      {continues && <EventContinuationMarker direction="end" label="Tiếp tục sang ngày sau" />}
    </button></div>
  );
}

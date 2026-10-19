import { Fragment } from 'react';
import { useDragFeedback } from './DragFeedbackProvider';
import { eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';
import { isTimedEventResize } from '../calendar-dnd/eventSchedule';

export function CalendarDragGhost({ day, startMinute }: { day: string; startMinute: number }) {
  const feedback = useDragFeedback(), target = feedback.target;
  const resizing = isTimedEventResize(feedback.source);
  if (resizing) {
    const schedule = feedback.schedule ?? feedback.source!.event;
    const base = Date.parse(toTimestamp(parseDate(day)));
    const start = Math.max(startMinute, (Date.parse(schedule.starts_at) - base) / 60000);
    const end = Math.min(1440, (Date.parse(schedule.ends_at) - base) / 60000);
    if (end <= start) return null;
    const lane = feedback.source!.lane;
    const boundary = feedback.source!.action === 'start' ? start : end;
    return <Fragment>
      <div className="calendar-resize-boundary" data-resize-boundary={feedback.source!.action} style={{ top: boundary - startMinute }} />
      <div data-drag-ghost={day} data-resize-event-id={feedback.source!.event.id} className={`calendar-drag-ghost calendar-resize-ghost ${end - start < 40 ? 'is-short-ghost' : ''} ${feedback.valid === false ? 'is-invalid' : ''}`} style={{ top: start - startMinute, height: end - start, ...(lane ? { left: lane.left, width: lane.width, right: 'auto' } : {}) }}>
        <span className="calendar-resize-time">{eventTime(schedule.starts_at)} – {eventTime(schedule.ends_at)}</span>
        {end - start >= 40 && <strong className="calendar-resize-title">{feedback.source!.event.title}</strong>}
        <i className="calendar-resize-grip" aria-hidden="true" />
      </div>
    </Fragment>;
  }
  if (!feedback.valid || target?.type !== 'calendar-slot' || target.date !== day) return null;
  let top, height = 24, time = target.time;
  if (feedback.schedule) {
    const base = Date.parse(toTimestamp(parseDate(day)));
    top = Math.max(0, (Date.parse(feedback.schedule.starts_at) - base) / 60000);
    height = Math.max(24, Math.min(1440, (Date.parse(feedback.schedule.ends_at) - base) / 60000) - top);
    time = eventTime(feedback.schedule.starts_at);
  } else top = Number(time!.slice(0, 2)) * 60 + Number(time!.slice(3));
  return <div data-drag-ghost={day} className="calendar-drag-ghost" style={{ top: top - startMinute, height }}><span>{time}</span> {feedback.source?.task?.title || feedback.source?.event?.title}</div>;
}

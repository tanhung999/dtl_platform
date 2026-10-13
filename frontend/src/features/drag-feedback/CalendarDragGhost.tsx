import { useDragFeedback } from './DragFeedbackProvider';
import { eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';

export function CalendarDragGhost({ day, startMinute }: { day: string; startMinute: number }) {
  const feedback = useDragFeedback(), target = feedback.target;
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

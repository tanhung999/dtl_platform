import { addDays, eventDate, parseDate, toTimestamp } from '../calendar/dateUtils';
import type { NoteSchedule } from './types';

/** Preserve the chosen date span when moving the start or changing all-day mode. */
export function changeNoteScheduleStart(value: NoteSchedule, day: string, time: string): NoteSchedule {
  if (!day) return value;
  const start = toTimestamp(parseDate(day), time || '00:00');
  const oldStart = Date.parse(value.starts_at), oldEnd = Date.parse(value.ends_at);
  const duration = oldEnd - oldStart;
  let end: number;
  if (value.is_all_day === !time) end = Date.parse(start) + duration;
  else {
    const first = eventDate(value.starts_at);
    const last = eventDate(new Date(oldEnd - 1).toISOString());
    const days = Math.round((last.getTime() - first.getTime()) / 86400000) + 1;
    // A new timed range defaults to 30 minutes on its selected final day.
    end = time ? Date.parse(toTimestamp(addDays(parseDate(day), days - 1), time)) + 30 * 60000
      : Date.parse(toTimestamp(addDays(parseDate(day), days)));
  }
  return { ...value, starts_at: start, ends_at: new Date(end).toISOString(), is_all_day: !time };
}

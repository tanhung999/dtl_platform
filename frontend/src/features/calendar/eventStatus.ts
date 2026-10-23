import { CalendarEvent } from './types';

export const EVENT_STATUSES = {
  upcoming: { label: 'Sắp tới', color: '#EAB308' },
  ongoing: { label: 'Đang diễn ra', color: '#2563EB' },
  ended: { label: 'Đã kết thúc', color: '#16A34A' },
} as const;

export function eventStatus(event: Pick<CalendarEvent, 'starts_at' | 'ends_at' | 'recurrence' | 'series_id' | 'recurrence_until'>, now: Date, displayDay: string) {
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const timestamp = now.getTime();
  let start = Date.parse(event.starts_at), end = Date.parse(event.ends_at);
  const days = event.recurrence === 'DAILY' ? 1 : event.recurrence === 'WEEKLY' ? 7 : 0;
  if (days && !event.series_id) {
    const dayEnd = Date.parse(`${displayDay}T00:00:00+07:00`) + 86400000;
    let offset = Math.max(0, Math.floor((dayEnd - 1 - start) / (days * 86400000))) * days * 86400000;
    if (event.recurrence_until) offset = Math.min(offset, Math.max(0, Math.floor((Date.parse(event.recurrence_until) - 1 - start) / (days * 86400000))) * days * 86400000);
    start += offset; end += offset;
  }
  const key = displayDay < today ? 'ended' : displayDay > today ? 'upcoming'
    : timestamp < start ? 'upcoming'
    : timestamp < end ? 'ongoing' : 'ended';
  return { key, ...EVENT_STATUSES[key] };
}

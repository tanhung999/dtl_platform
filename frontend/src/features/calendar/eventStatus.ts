import { CalendarEvent } from './types';

export const EVENT_STATUSES = {
  upcoming: { label: 'Sắp tới', color: '#2563EB' },
  ongoing: { label: 'Đang diễn ra', color: '#16A34A' },
  ended: { label: 'Đã kết thúc', color: '#64748B' },
} as const;

export function eventStatus(event: Pick<CalendarEvent, 'starts_at' | 'ends_at'>, now: Date, displayDay: string) {
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const timestamp = now.getTime();
  const key = displayDay < today ? 'ended' : displayDay > today ? 'upcoming'
    : timestamp < Date.parse(event.starts_at) ? 'upcoming'
    : timestamp < Date.parse(event.ends_at) ? 'ongoing' : 'ended';
  return { key, ...EVENT_STATUSES[key] };
}

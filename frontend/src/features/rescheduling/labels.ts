import { eventTime, eventDate, dateKey } from '../calendar/dateUtils';
import { Schedule } from './api';

const day = (value: string) => value.split('-').reverse().join('/');
export function scheduleLabel(value: Schedule): string {
  if ('due_date' in value) return value.due_date ? `${day(value.due_date)}${value.due_time ? ` · ${value.due_time}` : ' · Cả ngày'}` : 'Chưa có hạn';
  if (!value.starts_at || !value.ends_at) return 'Chưa có lịch';
  const start = dateKey(eventDate(value.starts_at)), end = dateKey(eventDate(value.is_all_day ? new Date(Date.parse(value.ends_at) - 1).toISOString() : value.ends_at));
  return value.is_all_day ? `${day(start)}${start === end ? '' : ` – ${day(end)}`} · Cả ngày` : `${day(start)} · ${eventTime(value.starts_at)} – ${start === end ? '' : day(end) + ' · '}${eventTime(value.ends_at)}`;
}

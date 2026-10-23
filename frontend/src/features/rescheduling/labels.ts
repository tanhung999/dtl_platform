import { eventTime, eventDate, dateKey } from '../calendar/dateUtils';
import { Schedule } from './api';

const day = (value: string) => value.split('-').reverse().join('/');
export function scheduleLabel(value: Schedule): string {
  if ('due_date' in value) return value.due_date ? `${day(value.due_date)}${value.due_time ? ` · ${value.due_time}` : ' · Cả ngày'}` : 'Chưa có hạn';
  if (!value.starts_at || !value.ends_at) return 'Chưa có lịch';
  const start = dateKey(eventDate(value.starts_at)), end = dateKey(eventDate(value.is_all_day ? new Date(Date.parse(value.ends_at) - 1).toISOString() : value.ends_at));
  const repeat = value.recurrence === 'DAILY' ? ' · Hằng ngày' : value.recurrence === 'WEEKLY' ? ' · Hằng tuần' : '';
  return (value.is_all_day ? `${day(start)}${start === end ? '' : ` – ${day(end)}`} · Cả ngày` : `${day(start)} · ${eventTime(value.starts_at)} – ${start === end ? '' : day(end) + ' · '}${eventTime(value.ends_at)}`) + repeat;
}

export function sameScheduleFields(a: Schedule, b: Schedule): boolean {
  return (['due_date','due_time','starts_at','ends_at','is_all_day','recurrence'] as const).every(key => (a[key] ?? null) === (b[key] ?? null));
}
export function notificationLabel(value: Schedule): string {
  if (value.reminder_at) return new Date(value.reminder_at).toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false });
  if (value.reminder_minutes == null) return 'Không nhắc';
  if (value.reminder_minutes === 0) return 'Đúng giờ';
  return value.reminder_minutes % 60 === 0 ? `Trước ${value.reminder_minutes / 60} giờ` : `Trước ${value.reminder_minutes} phút`;
}

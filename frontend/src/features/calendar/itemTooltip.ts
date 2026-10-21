import type { CalendarEvent } from './types';
import type { Task } from '../../types';
import { dateKey, eventDate, eventTime, parseDate } from './dateUtils';
import { eventStatus } from './eventStatus';
import { isOverdue, overdueLabel, PRIORITY_LABELS } from '../tasks/deadlineUtils';

const DAY = 86400000;
const heading = (title: string) => title.replace(/\s+/g, ' ').trim();
const shortDate = (day: Date, year: boolean) => `${String(day.getUTCDate()).padStart(2, '0')}/${String(day.getUTCMonth()+1).padStart(2, '0')}${year ? '/'+day.getUTCFullYear() : ''}`;

// Use the entire interval and current status, independent of the grid's visible slice.
export function eventTooltip(event: Pick<CalendarEvent, 'title' | 'starts_at' | 'ends_at' | 'is_all_day'>, now: Date): string {
  const first = eventDate(event.starts_at), last = eventDate(new Date(Date.parse(event.ends_at)-1).toISOString());
  const current = eventDate(now.toISOString());
  const total = Math.round((last.getTime()-first.getTime())/DAY)+1;
  const year = first.getUTCFullYear() !== current.getUTCFullYear() || last.getUTCFullYear() !== first.getUTCFullYear();
  const start = shortDate(first, year), end = shortDate(last, year);
  let range: string;
  if (event.is_all_day) range = `Cả ngày · ${start}${total > 1 ? ' – '+end+' ('+total+' ngày)' : ''}`;
  else {
    const endDay = eventDate(event.ends_at);
    range = `${start} · ${eventTime(event.starts_at)} – ${dateKey(first) === dateKey(endDay) ? '' : shortDate(endDay,year)+' · '}${eventTime(event.ends_at)}`;
  }
  const status = eventStatus(event, now, dateKey(current));
  const progress = status.key === 'ongoing' && total > 1 ? ` · ngày thứ ${Math.floor((current.getTime()-first.getTime())/DAY)+1}/${total}` : '';
  return `${heading(event.title)}\n${range}\n● ${status.label}${progress}`;
}

export function taskTooltip(task: Task, now: Date): string {
  const current = eventDate(now.toISOString());
  const day = task.due_date ? parseDate(task.due_date) : null;
  const range = day ? `Hạn · ${shortDate(day, day.getUTCFullYear() !== current.getUTCFullYear())} · ${task.due_time || 'Cả ngày'}` : 'Chưa đặt hạn';
  const late = isOverdue(task, now);
  const status = task.is_completed ? 'Đã hoàn thành' : late ? `Quá hạn · ${overdueLabel(task, now)}` : 'Chưa hoàn thành';
  return `${heading(task.title)}\n${range}\n● ${status} · Ưu tiên ${PRIORITY_LABELS[task.priority]}`;
}

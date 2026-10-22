import { eventTooltip, taskTooltip } from '../calendar/itemTooltip';
import { Task, TaskPriority } from '../../types';
import { CalendarEvent } from '../calendar/types';
import { addDays, dateKey, eventDate, eventTime, formatDate, toTimestamp } from '../calendar/dateUtils';
import { SharedItem, Scope } from './api';

export const sharedKindLabel = (item: SharedItem) => item.kind === 'note' ? 'Ghi chú' : item.kind === 'task' ? 'Công việc' : 'Sự kiện';
export function permitted(item: SharedItem, scope: Scope) {
  return item.kind === 'note' ? scope.share_notes : item.kind === 'task' ? scope.share_tasks : scope.share_events;
}
export function sharedEvent(item: SharedItem): CalendarEvent {
  return { id: item.id, user_id: '', title: item.title, starts_at: item.starts_at!, ends_at: item.ends_at!,
    is_all_day: !!item.is_all_day, description: '', location: '', color: '#2563eb', scheduled_note_id: item.note_id,
    created_at: item.starts_at!, updated_at: item.starts_at! };
}
export function sharedTask(item: SharedItem): Task {
  return { id: item.id, title: item.title, user_id: '', due_date: item.due_date ?? null, due_time: item.due_time ?? null,
    priority: (item.priority ?? 'MEDIUM') as TaskPriority, is_completed: !!item.is_completed,
    version: 0, deadline_version: 0, is_private: false, created_at: '', updated_at: '' };
}
export function sharedRangeLabel(item: SharedItem): string {
  if (item.kind === 'task') {
    return `${formatDate(new Date(item.due_date + 'T00:00:00Z'))} · ${item.due_time || 'Cả ngày'}${item.is_completed ? ' · Đã xong' : ''}`;
  }
  const first = eventDate(item.starts_at!), last = eventDate(item.is_all_day ? new Date(Date.parse(item.ends_at!) - 1).toISOString() : item.ends_at!);
  if (item.is_all_day) return `${formatDate(first)}${dateKey(first) !== dateKey(last) ? ` – ${formatDate(last)}` : ''} · Cả ngày`;
  return `${formatDate(first)} ${eventTime(item.starts_at!)} – ${dateKey(first) !== dateKey(last) ? formatDate(last) + ' ' : ''}${eventTime(item.ends_at!)}`;
}
export function sharedItemsOnDay(items: SharedItem[], day: Date) {
  const start = Date.parse(toTimestamp(day)), end = Date.parse(toTimestamp(addDays(day, 1)));
  return items.filter(item => item.kind === 'task' ? item.due_date === dateKey(day) : Date.parse(item.starts_at!) < end && Date.parse(item.ends_at!) > start);
}

export function sharedItemTooltip(item: SharedItem, now: Date): string {
  return item.kind === 'task' ? taskTooltip(sharedTask(item), now) : eventTooltip(sharedEvent(item), now);
}

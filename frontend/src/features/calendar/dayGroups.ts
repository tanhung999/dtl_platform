import type { Task } from '../../types';
import type { CalendarEvent } from './types';
import { addDays, dateKey, toTimestamp } from './dateUtils';

/** Build visible day buckets once, including every day covered by a multi-day event. */
export function calendarDayGroups(events: CalendarEvent[], tasks: Task[], first: Date, length: number) {
  const groups = Array.from({ length }, (_, index) => ({
    day: addDays(first, index), events: [] as CalendarEvent[], tasks: [] as Task[],
  }));
  const byDate = new Map(groups.map(group => [dateKey(group.day), group]));
  for (const task of tasks) if (task.due_date) byDate.get(task.due_date)?.tasks.push(task);
  const start = Date.parse(toTimestamp(first)), day = 86400000;
  for (const event of events) {
    const from = Date.parse(event.starts_at), until = Date.parse(event.ends_at);
    if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from) continue;
    const left = Math.max(0, Math.floor((from - start) / day));
    const right = Math.min(length - 1, Math.ceil((until - start) / day) - 1);
    for (let index = left; index <= right; index++) groups[index].events.push(event);
  }
  for (const group of groups) group.events.sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || a.starts_at.localeCompare(b.starts_at));
  return groups;
}

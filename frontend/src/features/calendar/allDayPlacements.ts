import { Task } from '../../types';
import { CalendarEvent } from './types';
import { addDays, dateKey, eventsOnDay, startOfWeek } from './dateUtils';

export type AllDayItem = { start: number; end: number; lane: number } &
  ({ kind: 'event'; event: CalendarEvent } | { kind: 'deadline'; task: Task });

export function allDayPlacements(events: CalendarEvent[], tasks: Task[], anchor: Date): AllDayItem[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const items: AllDayItem[] = [];
  events.filter(event => event.is_all_day).forEach(event => {
    const indices = days.flatMap((day, i) => eventsOnDay([event], day).length ? [i] : []);
    if (indices.length) items.push({ kind: 'event', event, start: indices[0], end: indices[indices.length - 1], lane: 0 });
  });
  tasks.filter(task => task.due_date && !task.due_time).forEach(task => {
    const index = days.findIndex(day => dateKey(day) === task.due_date);
    if (index >= 0) items.push({ kind: 'deadline', task, start: index, end: index, lane: 0 });
  });
  items.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const occupied: boolean[][] = [];
  items.forEach(item => {
    let lane = occupied.findIndex(row => row.slice(item.start, item.end + 1).every(value => !value));
    if (lane < 0) { lane = occupied.length; occupied.push(Array(7).fill(false)); }
    for (let day = item.start; day <= item.end; day++) occupied[lane][day] = true;
    item.lane = lane;
  });
  return items;
}

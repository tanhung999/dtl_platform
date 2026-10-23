import { Task } from '../../types';
import { CalendarEvent } from './types';
import { arrangeTimedLanes, dateKey, timedPlacements } from './dateUtils';

export const DEADLINE_MARKER_HEIGHT = 24;
interface Position { start: number; end: number; lane: number; lanes: number; laneSpan?: number; minimumHeight?: number; }
export type WeekTimedItem = Position & ({ kind: 'event'; event: CalendarEvent } | { kind: 'deadline'; task: Task });

export function weekTimedPlacements(events: CalendarEvent[], tasks: Task[], date: Date, startMinute = 0): WeekTimedItem[] {
  const items: WeekTimedItem[] = timedPlacements(events, date).filter(item => item.end > startMinute).map(item => ({ ...item, start: Math.max(startMinute, item.start), kind: 'event' }));
  tasks.filter(task => task.due_date === dateKey(date) && task.due_time).forEach(task => {
    const [hour, minute] = task.due_time!.split(':').map(Number);
    const start = hour * 60 + minute;
    // Deadline is a point in time; this height only reserves space for the card.
    if (start >= startMinute) items.push({ kind: 'deadline', task, start, end: start + DEADLINE_MARKER_HEIGHT, minimumHeight: DEADLINE_MARKER_HEIGHT, lane: 0, lanes: 1 });
  });
  return arrangeTimedLanes(items);
}

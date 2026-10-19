import { CalendarEvent } from '../calendar/types';
import { addDays, dateKey, parseDate, toTimestamp } from '../calendar/dateUtils';
import { DeadlineDropTarget } from '../task-calendar/deadlineDropTargets';

export type EventDragAction = 'move' | 'start' | 'end';
export interface EventLane { left: string; width: string }
export interface EventDragData { type: 'calendar-event'; event: CalendarEvent; sourceDay: string; action: EventDragAction; lane?: EventLane }
export const isTimedEventResize = (data?: Record<string, any>) => data?.type === 'calendar-event' && (data.action === 'start' || data.action === 'end') && !data.event.is_all_day;
export interface EventSchedule { starts_at: string; ends_at: string; is_all_day: boolean }
const DAY = 86400000, STEP = 15 * 60000;

export function eventSchedule(data: EventDragData, target: DeadlineDropTarget, minute?: number): EventSchedule {
  const event = data.event, originalStart = Date.parse(event.starts_at), originalEnd = Date.parse(event.ends_at);
  const dayStart = Date.parse(toTimestamp(parseDate(target.date)));
  const isSlot = target.type === 'calendar-slot';
  const targetTime = isSlot ? dayStart + (minute ?? Number(target.time!.slice(0, 2)) * 60) * 60000 : dayStart;
  let start = originalStart, end = originalEnd, allDay = event.is_all_day;
  if (data.action === 'move') {
    if (target.type === 'calendar-day' || (event.is_all_day && !isSlot)) {
      const shift = Date.parse(target.date) - Date.parse(data.sourceDay);
      start += shift; end += shift;
    } else if (isSlot) {
      const displayedStart = Math.max(originalStart, Date.parse(toTimestamp(parseDate(data.sourceDay))));
      const shift = targetTime - displayedStart;
      start += shift; end += shift; allDay = false;
    } else {
      start = dayStart; end = start + Math.max(1, Math.ceil((originalEnd - originalStart) / DAY)) * DAY; allDay = true;
    }
  } else {
    if (isSlot) allDay = false;
    const minimum = allDay ? DAY : STEP;
    if (data.action === 'start') start = Math.min(targetTime, end - minimum);
    else end = Math.max(isSlot ? targetTime : dayStart + DAY, start + minimum);
  }
  return { starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString(), is_all_day: allDay };
}

export function slotMinute(target: DeadlineDropTarget, y?: number, rect?: { top: number; height: number }): number | undefined {
  if (target.type !== 'calendar-slot') return;
  const base = Number(target.time!.slice(0, 2)) * 60 + Number(target.time!.slice(3));
  const fraction = y === undefined || !rect ? 0 : Math.max(0, Math.min(59, (y - rect.top) / rect.height * 60));
  return Math.min(1440, base + Math.round(fraction / 15) * 15);
}

export const nextDay = (day: string) => dateKey(addDays(parseDate(day), 1));

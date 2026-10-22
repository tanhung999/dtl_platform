import { CalendarEvent, CalendarView } from './types';

// Grid dates are UTC-midnight date-only values. Real event timestamps are UTC
// instants displayed in Vietnam time, independent of the browser's time zone.
const DAY = 86_400_000;
const VN_OFFSET = 7 * 60 * 60 * 1000;
export const MIN_EVENT_HEIGHT = 48;
export const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function eventDate(timestamp: string): Date {
  return parseDate(dateKey(new Date(new Date(timestamp).getTime() + VN_OFFSET)));
}

export function today(): Date {
  return eventDate(new Date().toISOString());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

export function addMonths(date: Date, months: number): Date {
  const first = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return first;
}

export function startOfWeek(date: Date): Date {
  return addDays(date, -((date.getUTCDay() + 6) % 7));
}

export function monthDays(anchor: Date): Date[] {
  const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

export function toTimestamp(date: Date, time = '00:00'): string {
  return new Date(`${dateKey(date)}T${time}:00+07:00`).toISOString();
}

export function eventTime(timestamp: string): string {
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(timestamp));
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions = {}): string {
  return date.toLocaleDateString('vi-VN', { timeZone: 'UTC', ...options });
}

export function eventsOnDay(events: CalendarEvent[], date: Date): CalendarEvent[] {
  const start = new Date(toTimestamp(date)).getTime();
  const end = start + DAY;
  return events.filter(event => new Date(event.starts_at).getTime() < end && new Date(event.ends_at).getTime() > start)
    .sort((a, b) => Number(b.is_all_day) - Number(a.is_all_day) || a.starts_at.localeCompare(b.starts_at));
}

export function eventLabel(event: CalendarEvent): string {
  if (event.is_all_day) return 'Cả ngày';
  const start = eventTime(event.starts_at);
  const end = eventTime(event.ends_at);
  if (dateKey(eventDate(event.starts_at)) !== dateKey(eventDate(event.ends_at))) {
    return `${formatDate(eventDate(event.starts_at))} ${start} – ${formatDate(eventDate(event.ends_at))} ${end}`;
  }
  return `${start} – ${end}`;
}

// Nhãn theo đoạn đang xem; mốc kết thúc 00:00 không tạo thêm ngày hiển thị.
export function eventDayLabel(event: CalendarEvent, day: string, compact = false): string {
  if (event.is_all_day) return 'Cả ngày';
  const dayStart = Date.parse(toTimestamp(parseDate(day)));
  const dayEnd = dayStart + DAY;
  const start = Date.parse(event.starts_at), end = Date.parse(event.ends_at);
  const fromPrevious = start < dayStart, intoNext = end > dayEnd;
  if (fromPrevious && intoNext) return compact ? 'Tiếp tục' : 'Tiếp tục từ ngày trước';
  if (fromPrevious) return `Đến ${end === dayEnd ? '24:00' : eventTime(event.ends_at)}`;
  if (intoNext) return `Từ ${eventTime(event.starts_at)}`;
  return `${eventTime(event.starts_at)} – ${end === dayEnd ? '24:00' : eventTime(event.ends_at)}`;
}

export function eventContinuation(event: CalendarEvent, day: string, startMinute = 0): string | undefined {
  if (event.is_all_day) return undefined;
  const visibleStart = Date.parse(toTimestamp(parseDate(day))) + startMinute * 60000;
  if (Date.parse(event.starts_at) >= visibleStart || Date.parse(event.ends_at) <= visibleStart) return undefined;
  return startMinute ? `Tiếp tục từ trước ${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(startMinute % 60).padStart(2, '0')}` : 'Tiếp tục từ ngày trước';
}

export function eventContinuesNextDay(event: CalendarEvent, day: string): boolean {
  const nextMidnight = Date.parse(toTimestamp(addDays(parseDate(day), 1)));
  return !event.is_all_day && Date.parse(event.starts_at) < nextMidnight && Date.parse(event.ends_at) > nextMidnight;
}

export function viewRange(anchor: Date, view: CalendarView): { start: Date; end: Date } {
  if (view === 'month') {
    const days = monthDays(anchor);
    return { start: days[0], end: addDays(days[41], 1) };
  }
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { start, end: addDays(start, 7) };
  }
  return { start: anchor, end: addDays(anchor, 30) };
}

export interface TimedPlacement {
  event: CalendarEvent;
  start: number;
  end: number;
  lane: number;
  lanes: number;
  laneSpan?: number;
}

export function timedPlacements(events: CalendarEvent[], date: Date): TimedPlacement[] {
  const dayStart = new Date(toTimestamp(date)).getTime();
  const placements = eventsOnDay(events, date).filter(event => !event.is_all_day).map(event => ({
    event,
    start: Math.max(0, (new Date(event.starts_at).getTime() - dayStart) / 60000),
    end: Math.min(1440, (new Date(event.ends_at).getTime() - dayStart) / 60000),
    lane: 0,
    lanes: 1,
  })).sort((a, b) => a.start - b.start || b.end - a.end);

  return arrangeTimedLanes(placements);
}

// Both events and timed task deadlines share lanes so their cards do not cover each other.
export function arrangeTimedLanes<T extends { start: number; end: number; lane: number; lanes: number; laneSpan?: number; minimumHeight?: number }>(items: T[]): T[] {
  const placements = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let group: T[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;
  const paintedEnd = (item: T) => Math.max(item.end, item.start + (item.minimumHeight ?? MIN_EVENT_HEIGHT));
  const finish = () => {
    const lanes = laneEnds.length;
    const byLane = Array.from({ length: lanes }, (_, lane) => group.filter(item => item.lane === lane));
    group.forEach(item => {
      item.lanes = lanes;
      item.laneSpan = 1;
      // Only reserve a neighboring column when an item there actually overlaps.
      for (let lane = item.lane + 1; lane < lanes; lane++) {
        if (byLane[lane].some(other => other.start < paintedEnd(item) && paintedEnd(other) > item.start)) break;
        item.laneSpan++;
      }
    });
  };
  for (const item of placements) {
    // Account for the painted title, status and time when assigning overlap lanes.
    const displayEnd = Math.max(item.end, item.start + (item.minimumHeight ?? MIN_EVENT_HEIGHT));
    if (item.start >= groupEnd) {
      finish();
      group = [];
      laneEnds = [];
      groupEnd = -1;
    }
    const freeLane = laneEnds.findIndex(end => end <= item.start);
    item.lane = freeLane < 0 ? laneEnds.length : freeLane;
    laneEnds[item.lane] = displayEnd;
    groupEnd = Math.max(groupEnd, displayEnd);
    group.push(item);
  }
  finish();
  return placements;
}

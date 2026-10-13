export interface DeadlineDropTarget {
  type: 'calendar-day' | 'calendar-all-day' | 'calendar-slot';
  date: string;
  time?: string;
}

export function deadlineDropTarget(value: unknown): DeadlineDropTarget | undefined {
  if (!value || typeof value !== 'object') return;
  const target = value as DeadlineDropTarget;
  if (!['calendar-day', 'calendar-all-day', 'calendar-slot'].includes(target.type) || !/^\d{4}-\d{2}-\d{2}$/.test(target.date)) return;
  if (target.type === 'calendar-slot' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(target.time || '')) return;
  return target;
}

export const shortDeadlineDate = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
export const deadlineDropLabel = (target: DeadlineDropTarget) => `Đặt hạn ${shortDeadlineDate(target.date)}${target.type === 'calendar-slot' ? ` ${target.time}` : target.type === 'calendar-all-day' ? ' · Cả ngày' : ''}`;

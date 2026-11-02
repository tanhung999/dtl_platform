import type { Recurrence } from './types';

// Project read-only fields onto the selected occurrence. Keep the source
// schedule intact so saving content cannot accidentally move the series.
export function occurrenceSchedule<T extends { starts_at?: string; ends_at?: string; recurrence?: Recurrence }>(value: T, at?: string): T {
  if (!at || !value.starts_at || !value.ends_at || !value.recurrence || value.recurrence === 'NONE') return value;
  const start = Date.parse(at), duration = Date.parse(value.ends_at) - Date.parse(value.starts_at);
  if (!Number.isFinite(start) || !Number.isFinite(duration)) return value;
  return { ...value, starts_at: at, ends_at: new Date(start + duration).toISOString() };
}

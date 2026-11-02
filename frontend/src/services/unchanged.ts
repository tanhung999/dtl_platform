// Compare editable values only; version guards are sent only for actual edits.
import { sameReminder } from '../features/reminders/reminderUtils';
export function sameFields(current: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  const equal = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((value, index) => equal(value, b[index]))
    : (a ?? '') === (b ?? '');
  return Object.keys(current).every(key => equal(current[key], saved[key]));
}

export function sameSchedule(current?: { starts_at: string; ends_at: string; is_all_day: boolean; recurrence?: string; reminder_minutes?: number | null; reminder_at?: string | null; reminder_repeat?: boolean } | null, saved?: { starts_at: string; ends_at: string; is_all_day: boolean; recurrence?: string; reminder_minutes?: number | null; reminder_at?: string | null; reminder_repeat?: boolean } | null): boolean {
  if (!current || !saved) return !current && !saved;
  return Date.parse(current.starts_at) === Date.parse(saved.starts_at)
    && Date.parse(current.ends_at) === Date.parse(saved.ends_at) && current.is_all_day === saved.is_all_day && (current.recurrence ?? 'NONE') === (saved.recurrence ?? 'NONE')
    && sameReminder(current, saved);
}

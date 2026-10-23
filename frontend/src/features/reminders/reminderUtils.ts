export interface ReminderValue { reminder_minutes?: number | null; reminder_at?: string | null }
export const noReminder = (): ReminderValue => ({ reminder_minutes: null, reminder_at: null });
export const reminderValue = (value: ReminderValue): ReminderValue => ({ reminder_minutes: value.reminder_minutes ?? null, reminder_at: value.reminder_at ?? null });
export function sameReminder(a: ReminderValue, b: ReminderValue): boolean {
  return (a.reminder_minutes ?? null) === (b.reminder_minutes ?? null)
    && (a.reminder_at ? Date.parse(a.reminder_at) : null) === (b.reminder_at ? Date.parse(b.reminder_at) : null);
}


// Date-only tasks expire at the next Vietnam midnight. All-day appointments
// may span several days and use their exclusive end, not their first midnight.
export function reminderCutoff(anchor: string | null | undefined, allDay: boolean, endsAt?: string | null): number | null {
  const start = anchor ? Date.parse(anchor) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = endsAt ? Date.parse(endsAt) : null;
  if (end !== null && (!Number.isFinite(end) || end <= start)) return null;
  return end ?? (allDay ? start + 86400000 : start);
}

export function reminderAvailable(anchor: string | null | undefined, allDay: boolean, now: number, endsAt?: string | null): boolean {
  if (!anchor && !endsAt) return true; // Absolute reminders need no deadline.
  const cutoff = reminderCutoff(anchor, allDay, endsAt);
  return cutoff !== null && Number.isFinite(now); // Elapsed items still allow a future absolute reminder.
}

// Appointments must remind strictly before the end; timed tasks allow the exact deadline.
export function reminderBeyondLimit(stamp: string | null | undefined, anchor: string | null | undefined, allDay: boolean, endsAt?: string | null, now = Date.now()): boolean {
  const cutoff = reminderCutoff(anchor, allDay, endsAt);
  if (!stamp || cutoff === null || cutoff <= now) return false;
  const time = Date.parse(stamp);
  return time > cutoff || (!!endsAt || allDay) && time === cutoff;
}


// Date/time controls accept whole minutes. Never suggest a past minute when an
// exclusive appointment end leaves less than one selectable minute remaining.
export function nextReminderMinute(preferred: number, now: number, cutoff: number | null, exclusive: boolean): number | null {
  if (!Number.isFinite(preferred) || !Number.isFinite(now)) return null;
  const minute = 60000;
  const earliest = Math.floor(now / minute) * minute + minute;
  const latest = cutoff === null || cutoff <= now ? Infinity
    : (exclusive ? Math.ceil(cutoff / minute) - 1 : Math.floor(cutoff / minute)) * minute;
  if (latest < earliest) return null;
  return Math.min(latest, Math.max(earliest, Math.ceil(preferred / minute) * minute));
}

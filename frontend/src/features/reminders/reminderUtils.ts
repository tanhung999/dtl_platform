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
  const cutoff = reminderCutoff(anchor, allDay, endsAt);
  return cutoff !== null && cutoff > now;
}

// Appointments must remind strictly before the end; timed tasks allow the exact deadline.
export function reminderBeyondLimit(stamp: string | null | undefined, anchor: string | null | undefined, allDay: boolean, endsAt?: string | null): boolean {
  const cutoff = reminderCutoff(anchor, allDay, endsAt);
  if (!stamp || cutoff === null) return false;
  const time = Date.parse(stamp);
  return time > cutoff || (!!endsAt || allDay) && time === cutoff;
}

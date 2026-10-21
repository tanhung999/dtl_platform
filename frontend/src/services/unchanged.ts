// Compare editable values only; version guards are sent only for actual edits.
export function sameFields(current: Record<string, unknown>, saved: Record<string, unknown>): boolean {
  return Object.keys(current).every(key => (current[key] ?? '') === (saved[key] ?? ''));
}

export function sameSchedule(current?: { starts_at: string; ends_at: string; is_all_day: boolean; reminder_minutes?: number | null; reminder_at?: string | null } | null, saved?: { starts_at: string; ends_at: string; is_all_day: boolean; reminder_minutes?: number | null; reminder_at?: string | null } | null): boolean {
  if (!current || !saved) return !current && !saved;
  return Date.parse(current.starts_at) === Date.parse(saved.starts_at)
    && Date.parse(current.ends_at) === Date.parse(saved.ends_at) && current.is_all_day === saved.is_all_day
    && (current.reminder_minutes ?? null) === (saved.reminder_minutes ?? null)
    && (current.reminder_at ? Date.parse(current.reminder_at) : null) === (saved.reminder_at ? Date.parse(saved.reminder_at) : null);
}

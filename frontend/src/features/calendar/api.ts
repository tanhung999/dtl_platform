import type { CalendarDays } from './types';
import { CalendarEvent, CalendarEventInput } from './types';
import { requestWithTimeout } from '../../services/requestTimeout';
import { CreateAttempt, createWithRecovery, deleteWithRecovery, recoverMutation } from '../../services/mutationRecovery';

const base = '/api/calendar/events';
export interface EventRange { items: CalendarEvent[]; total: number; event_total: number; note_total: number; truncated: boolean }
const matches = (event: CalendarEvent, payload: Partial<CalendarEventInput>) => Object.entries(payload).every(([key, value]) => {
  if (key.startsWith('expected_')) return true;
  if (key === 'starts_at' || key === 'ends_at') return Date.parse(event[key]) === Date.parse(String(value));
  if (key === 'reminder_at') return (event.reminder_at ? Date.parse(event.reminder_at) : null) === (value ? Date.parse(String(value)) : null);
  return event[key as keyof CalendarEvent] === (typeof value === 'string' ? value.trim() : value);
});

export const calendarApi = {
  days: (start: string, end: string, signal?: AbortSignal) => requestWithTimeout<CalendarDays>(`/api/calendar/days?${new URLSearchParams({ start, end })}`, { signal }),
  list(start: string, end: string, signal?: AbortSignal, includeEvents = true, includeNotes = true) {
    const query = new URLSearchParams({ start, end, include_events: String(includeEvents), include_notes: String(includeNotes) });
    return requestWithTimeout<EventRange>(`${base}/collection?${query}`, { signal });
  },
  get(id: string, signal?: AbortSignal) { return requestWithTimeout<CalendarEvent>(`${base}/${encodeURIComponent(id)}`, { cache: 'no-store', signal }, 5000); },
  create(payload: CalendarEventInput, attempt: CreateAttempt<CalendarEventInput>) {
    return createWithRecovery<CalendarEvent, CalendarEventInput>(base, payload, attempt, matches,
      (event, input) => calendarApi.update(event.id, { ...input, expected_updated_at: event.updated_at }));
  },
  update(id: string, payload: CalendarEventInput) {
    return recoverMutation(() => requestWithTimeout<CalendarEvent>(`${base}/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(payload),
    }), () => calendarApi.get(id), event => Date.parse(event.updated_at) >= Date.parse(payload.expected_updated_at!) && matches(event, payload));
  },
  remove(id: string, updatedAt: string) {
    return deleteWithRecovery(`${base}/${encodeURIComponent(id)}`, new URLSearchParams({ expected_updated_at: updatedAt }));
  },
};

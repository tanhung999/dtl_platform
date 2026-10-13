import { request } from '../../services/api';
import { CalendarEvent, CalendarEventInput } from './types';

const base = '/api/calendar/events';

export const calendarApi = {
  list(start: string, end: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ start, end });
    return request<CalendarEvent[]>(`${base}?${query}`, { signal });
  },
  create(payload: CalendarEventInput) {
    return request<CalendarEvent>(base, { method: 'POST', body: JSON.stringify(payload) });
  },
  update(id: string, payload: CalendarEventInput) {
    return request<CalendarEvent>(`${base}/${encodeURIComponent(id)}`, {
      method: 'PUT', body: JSON.stringify(payload),
    });
  },
  remove(id: string) {
    return request<void>(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};

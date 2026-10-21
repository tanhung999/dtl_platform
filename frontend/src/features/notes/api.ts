import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { sameReminder } from '../reminders/reminderUtils';
export function notifyNotesChanged() { window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: ['notes', 'calendar'] })); }
import { recoverMutation } from '../../services/mutationRecovery';
import { request } from '../../services/api';
import { requestWithTimeout } from '../../services/requestTimeout';
import { Note } from '../../types';
import type { NoteCollection } from './types';
import type { NoteFilter } from './noteView';
export const notesApi = {
  get: (id: string, signal?: AbortSignal) => requestWithTimeout<Note>(`/api/notes/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }, 5000),
  create: (payload: Partial<Note> & { request_id: string }) => requestWithTimeout<Note>('/api/notes', { method: 'POST', body: JSON.stringify(payload) }),
  deleteInfo: (id: string, signal?: AbortSignal) => requestWithTimeout<{ id: string; title: string; has_calendar_schedule: boolean; version: number }>(`/api/notes/${encodeURIComponent(id)}/delete-info`, { signal, cache: 'no-store' }, 5000),
  remove: (id: string, expectedVersion: number) => requestWithTimeout<void>(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ expected_version: expectedVersion }) }),
  collection: (options: { archived: boolean; filter: NoteFilter; query: string; fullPage: boolean; offset: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ archived: String(options.archived), filter: options.filter, q: options.query, widget: String(!options.fullPage), offset: String(options.offset), limit: '24' });
    return request<NoteCollection>(`/api/notes/collection/page?${params}`, { signal });
  },
  async updateNote(id: string, payload: Partial<Note> & { expected_version: number }): Promise<Note> {
    return recoverMutation(() => requestWithTimeout<Note>(`/api/notes/${id}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    }), () => requestWithTimeout<Note>(`/api/notes/${id}`, { cache: 'no-store' }, 5000), latest => latest.version >= payload.expected_version && Object.entries(payload).every(([key, value]) => {
      if (key === 'expected_version') return true;
      if (key === 'calendar_schedule') {
        const schedule = value as NonNullable<Note['calendar_schedule']>;
        return !!latest.calendar_schedule && sameReminder(latest.calendar_schedule, schedule) && latest.calendar_schedule.is_all_day === schedule.is_all_day && ['starts_at', 'ends_at'].every(field => Date.parse(latest.calendar_schedule![field as 'starts_at' | 'ends_at']) === Date.parse(schedule[field as 'starts_at' | 'ends_at']));
      }
      return latest[key as keyof Note] === value;
    }));
  },
};

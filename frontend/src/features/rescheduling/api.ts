import type { Note } from '../../types';
import type { CalendarEvent } from '../calendar/types';
import type { ReminderValue } from '../reminders/ReminderFields';
import { requestWithTimeout } from '../../services/requestTimeout';
import { isUncertainFailure } from '../../services/mutationRecovery';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

export type Kind = 'task' | 'event' | 'note';
export interface Schedule extends ReminderValue { recurrence?: import("../calendar/types").Recurrence; due_date?: string | null; due_time?: string | null; starts_at?: string; ends_at?: string; is_all_day?: boolean }
export type EditorState = { kind: 'event'; resource: CalendarEvent; occurrence_at?: string | null } | { kind: 'note'; resource: Note; occurrence_at?: string | null };
export interface Change { editor?: EditorState; id: string; kind: Kind; resource_id: string; actor_name: string; reason: string; before: Schedule; after: Schedule; guard: { expected_version?: number; expected_updated_at?: string; event_id?: string; scoped?: {scope:string; child_id?: string; child_note_id?: string; occurrence_at?: string}; family?: {scope?:string} }; current?: Schedule; current_guard?: Change['guard']; created_at: string; undone_at: string | null }
export interface MoveInput extends Schedule { scope?: import("../calendar/components/RecurrenceScope").RecurrenceScope; occurrence_at?: string; request_id: string; reason: string; expected_version?: number; expected_updated_at?: string }
export const history = (kind: Kind, id: string, signal?: AbortSignal) => requestWithTimeout<Change[]>(`/api/schedule-changes/${kind}/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }, 5000);
async function write(path: string, body?: MoveInput) {
  const send = () => requestWithTimeout<Change>(path, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
  try { return await send(); }
  catch (reason) { if (!isUncertainFailure(reason) || !navigator.onLine) throw reason; return send(); }
}
export const move = (kind: Kind, id: string, body: MoveInput) => write(`/api/schedule-changes/${kind}/${encodeURIComponent(id)}`, body);
export const undo = (id: string) => write(`/api/schedule-changes/records/${encodeURIComponent(id)}/undo`);
export function notifyMoved(kind: Kind) {
  window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: kind === 'task' ? ['tasks', 'calendar', 'notifications'] : kind === 'note' ? ['notes', 'calendar'] : ['calendar'] }));
}

// A committed move must never be sent again just because its editor snapshot is missing.
export async function hydrateEditor(change: Change): Promise<Change> {
  if (change.editor || !change.guard.scoped || change.kind === 'task') return change;
  const scoped = change.guard.scoped;
  const id = change.undone_at ? change.resource_id : change.kind === 'note' ? scoped.child_note_id : scoped.child_id;
  if (!id) throw new Error('Không xác định được mục vừa cập nhật. Hãy tải lại trang để tiếp tục.');
  const occurrence_at = change.undone_at ? scoped.occurrence_at : change.after.starts_at;
  const editor: EditorState = change.kind === 'note'
    ? { kind: 'note', resource: await requestWithTimeout<Note>(`/api/notes/${encodeURIComponent(id)}`, { cache: 'no-store' }, 5000), occurrence_at }
    : { kind: 'event', resource: await requestWithTimeout<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(id)}`, { cache: 'no-store' }, 5000), occurrence_at };
  return { ...change, editor };
}

import type { ReminderValue } from '../reminders/ReminderFields';
import { requestWithTimeout } from '../../services/requestTimeout';
import { isUncertainFailure } from '../../services/mutationRecovery';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';

export type Kind = 'task' | 'event' | 'note';
export interface Schedule extends ReminderValue { recurrence?: import("../calendar/types").Recurrence; due_date?: string | null; due_time?: string | null; starts_at?: string; ends_at?: string; is_all_day?: boolean }
export interface Change { id: string; kind: Kind; resource_id: string; actor_name: string; reason: string; before: Schedule; after: Schedule; guard: { expected_version?: number; expected_updated_at?: string; event_id?: string; scoped?: {scope:string}; family?: {scope?:string} }; current?: Schedule; current_guard?: Change['guard']; created_at: string; undone_at: string | null }
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

import { notesApi } from './api';

import { Note } from '../../types';
import { NoteWrite } from './types';
export interface NoteCreateAttempt { requestId: string; original: NoteWrite }
const sameSchedule = (note: Note, payload: NoteWrite) => !payload.calendar_schedule || (!!note.calendar_schedule && ['starts_at', 'ends_at'].every(key => Date.parse(note.calendar_schedule![key as 'starts_at' | 'ends_at']) === Date.parse(payload.calendar_schedule![key as 'starts_at' | 'ends_at'])) && note.calendar_schedule.is_all_day === payload.calendar_schedule.is_all_day);
const sameContent = (note: Note, payload: NoteWrite) => note.title === payload.title && note.content === payload.content && note.color === payload.color && note.is_pinned === payload.is_pinned;
export async function createNoteWithRetry(payload: NoteWrite, attempt: NoteCreateAttempt) {
  // Recover the original create first, even if the user edited the form after a lost response.
  const original = { ...attempt.original, request_id: attempt.requestId };
  const note = await notesApi.create(original);
  if (sameContent(note, payload) && sameSchedule(note, payload)) return note;
  return notesApi.updateNote(note.id, { ...payload, ...(payload.calendar_schedule && note.calendar_schedule ? { calendar_schedule: { ...payload.calendar_schedule, event_id: note.calendar_schedule.event_id, expected_updated_at: note.calendar_schedule.expected_updated_at } } : {}), expected_version: note.version });
}

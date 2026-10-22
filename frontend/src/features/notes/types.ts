import type { CalendarEvent } from '../calendar/types';
export type ScheduledEvent = Pick<CalendarEvent, 'id' | 'title' | 'starts_at' | 'ends_at' | 'is_all_day'>;
export type NoteWrite = { reminder_at?: string | null; calendar_schedule?: import('../note-scheduling/types').NoteSchedule; title: string; content: string; color: string; is_pinned: boolean; is_private: boolean; expected_version?: number; request_id?: string };
export interface NoteSummary {
  is_private: boolean;
  id: string; title: string; preview: string; color: string; is_pinned: boolean; is_archived: boolean;
  version: number; created_at: string; updated_at: string; scheduled_event: ScheduledEvent | null;
}
export interface NoteCollection {
  server_now: string; next_refresh_at: string | null; items: NoteSummary[]; total: number; total_active: number; offset: number; limit: number;
  has_more: boolean; hidden: number; has_scheduled: boolean; pinned_total: number;
}

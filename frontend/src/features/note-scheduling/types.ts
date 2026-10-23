import type { ReminderValue } from '../reminders/ReminderFields';
export interface NoteSchedule extends ReminderValue {
  recurrence?: import("../calendar/types").Recurrence;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  event_id?: string;
  expected_updated_at?: string;
}

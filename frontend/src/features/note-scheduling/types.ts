export interface NoteSchedule {
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  event_id?: string;
  expected_updated_at?: string;
}

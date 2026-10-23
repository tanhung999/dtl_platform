import type { ReminderValue } from '../reminders/ReminderFields';
export type Recurrence = 'NONE' | 'DAILY' | 'WEEKLY';
export type CalendarView = 'week' | 'month' | 'agenda';

export interface CalendarEventInput extends ReminderValue {
  expected_updated_at?: string;
  recurrence?: Recurrence;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  is_private?: boolean;
  is_all_day: boolean;
  color: string;
}

export interface CalendarEvent extends CalendarEventInput {
  series_id?: string | null;
  series_recurrence?: Recurrence | null;
  deletion_includes_series?: boolean;
  recurrence_until?: string | null;
  scheduled_note_id?: string | null;
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
}

export interface EventDraft {
  occurrenceAt?: string;
  date: Date;
  hour?: number;
  allDay?: boolean;
}

export interface CalendarViewProps {
  anchor: Date;
  events: CalendarEvent[];
  tasks: Task[];
  onCreate: (draft: EventDraft) => void;
  onSelect: (event: CalendarEvent, day?: string) => void;
}

import { Task } from '../../types';


export type CalendarDays = Record<string, { events: number; notes: number; tasks: number; attention: boolean }>;

import type { ReminderValue } from '../features/reminders/ReminderFields';
export interface User {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  department: string;
  job_title?: string;
  employee_code?: string;
  phone?: string;
  office_location?: string;
  position_id?: string;
  work_location_id?: string;
  avatar_url?: string;
  bio?: string;
  allowed_apps?: string;
  created_at?: string;
}

export interface AuthSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface Note {
  calendar_occurrence_at?: string | null;
  calendar_series_recurrence?: 'DAILY' | 'WEEKLY' | null;
  reminder_at?: string | null;
  is_private: boolean;
  calendar_schedule?: import("../features/note-scheduling/types").NoteSchedule | null;
  version: number;
  id: string;
  user_id: string;
  title: string;
  content: string;
  color: string;
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Task extends ReminderValue {
  is_private: boolean;
  version: number;
  id: string;
  user_id: string;
  assignee_id?: string;
  creator?: UserBrief | null;
  assignee?: UserBrief | null;
  followers?: UserBrief[];
  is_following?: boolean;
  relationship?: 'OWNER' | 'ASSIGNEE' | 'FOLLOWER' | null;
  can_edit?: boolean;
  can_complete?: boolean;
  can_delete?: boolean;
  can_assign?: boolean;
  title: string;
  description?: string;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  legacy_due_date?: string | null;
  deadline_version: number;
  is_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserBrief { id: string; full_name: string; username: string; department?: string; job_title?: string; avatar_url?: string | null; }

export interface Bookmark {
  id: string;
  title: string;
  url: string;
  icon: string;
  category: string;
  is_global: boolean;
}

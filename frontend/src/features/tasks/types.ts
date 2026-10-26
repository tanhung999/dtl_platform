import type { ReminderValue } from '../reminders/ReminderFields';
import { TaskPriority } from '../../types';

export interface TaskInput extends ReminderValue {
  is_private?: boolean;
  expected_version?: number;
  title: string;
  description?: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  assignee_id?: string | null;
  follower_ids?: string[];
}

export type TaskFilter = 'ALL' | 'PENDING' | 'DONE' | 'OVERDUE';
export type TaskScope = 'all' | 'assigned_to_me' | 'created_by_me' | 'following';
export interface TaskCollection {
  server_now: string; next_refresh_at: string | null;
  next_cursor: string | null; overdue_next_cursor: string | null;
  items: import('../../types').Task[]; overdue: import('../../types').Task[];
  counts: Record<TaskFilter, number>; offset: number; limit: number; total: number; has_more: boolean;
  overdue_offset: number; overdue_has_more: boolean;
}

import { TaskPriority } from '../../types';

export interface TaskInput {
  title: string;
  description?: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
}

export interface TaskReminder {
  task_id: string;
  title: string;
  due_date: string;
  due_time: string | null;
  priority: TaskPriority;
  deadline_version: number;
  kind: 'before' | 'day';
  scheduled_at: string;
}

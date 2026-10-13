import { request } from '../../services/api';
import { Task } from '../../types';
import { TaskInput, TaskReminder } from './types';

export const tasksApi = {
  list(signal?: AbortSignal) { return request<Task[]>('/api/tasks', { signal }); },
  create(payload: TaskInput) { return request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }); },
  update(id: string, payload: Partial<TaskInput> & { is_completed?: boolean; expected_deadline_version?: number }) {
    return request<Task>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  remove(id: string) { return request<void>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }); },
  reminders(signal?: AbortSignal) { return request<TaskReminder[]>('/api/tasks/reminders', { signal }); },
  dismiss(reminder: TaskReminder) {
    return request<void>(`/api/tasks/${encodeURIComponent(reminder.task_id)}/reminders/${reminder.kind}/dismiss`, {
      method: 'POST', body: JSON.stringify({ deadline_version: reminder.deadline_version }),
    });
  },
  snooze(reminder: TaskReminder) {
    return request<void>(`/api/tasks/${encodeURIComponent(reminder.task_id)}/reminders/${reminder.kind}/snooze`, {
      method: 'POST', body: JSON.stringify({ deadline_version: reminder.deadline_version }),
    });
  },
};

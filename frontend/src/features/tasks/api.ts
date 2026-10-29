import { Task } from '../../types';
import { TaskInput, TaskFilter, TaskCollection, TaskScope } from './types';
import { requestWithTimeout } from '../../services/requestTimeout';
import { CreateAttempt, createWithRecovery, deleteWithRecovery, recoverMutation } from '../../services/mutationRecovery';

export interface TaskRange { items: Task[]; total: number; truncated: boolean }
const matchesTask = (task: Task, payload: Partial<TaskInput> & { is_completed?: boolean }) => Object.entries(payload).every(([key, value]) => {
  if (key.startsWith('expected_')) return true;
  if (key === 'description') return (task.description ?? '') === (value ?? '');
  if (key === 'reminder_at') return (task.reminder_at ? Date.parse(task.reminder_at) : null) === (value ? Date.parse(String(value)) : null);
  if (key === 'title') return task.title === String(value).trim();
  if (key === 'assignee_id') return task.assignee_id === (value ?? task.user_id);
  if (key === 'follower_ids') {
    const explicit = (ids: string[]) => ids.filter(id => id !== task.user_id && id !== task.assignee_id).sort();
    return JSON.stringify(explicit((task.followers ?? []).map(item => item.id))) === JSON.stringify(explicit(value as string[]));
  }
  if (key === 'due_date' && !value && payload.due_time) return task.due_date === new Date(task.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  return task[key as keyof Task] === value;
});

export const tasksApi = {
  get(id: string, signal?: AbortSignal) { return requestWithTimeout<Task>(`/api/tasks/${encodeURIComponent(id)}`, { cache: 'no-store', signal }, 5000); },
  collection(filter: TaskFilter, scope: TaskScope, offset: number, overdueOffset: number, signal?: AbortSignal, after?: string, overdueAfter?: string, limit = 8, query = '') {
    const params = new URLSearchParams({ filter, scope, offset: String(offset), overdue_offset: String(overdueOffset), limit: String(limit), q: query });
    if (after) params.set('after', after); if (overdueAfter) params.set('overdue_after', overdueAfter);
    return requestWithTimeout<TaskCollection>(`/api/tasks/collection?${params}`, { signal });
  },
  calendar(start: string, end: string, signal?: AbortSignal, offset = 0) { return requestWithTimeout<TaskRange>(`/api/tasks/calendar/page?${new URLSearchParams({ start, end, offset: String(offset) })}`, { signal }); },
  create(payload: TaskInput, attempt: CreateAttempt<TaskInput>) {
    return createWithRecovery<Task, TaskInput>('/api/tasks', payload, attempt, matchesTask,
      (task, input) => tasksApi.update(task.id, { ...input, expected_version: task.version }));
  },
  update(id: string, payload: Partial<TaskInput> & { is_completed?: boolean; expected_deadline_version?: number }) {
    return recoverMutation(() => requestWithTimeout<Task>(`/api/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      () => tasksApi.get(id), task => task.version >= (payload.expected_version ?? -1) && matchesTask(task, payload));
  },
  remove(id: string, version: number) { return deleteWithRecovery(`/api/tasks/${encodeURIComponent(id)}`, new URLSearchParams({ expected_version: String(version) })); },
};

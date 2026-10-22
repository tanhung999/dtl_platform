import { Task, TaskPriority } from '../../types';

// HIGH is read only as a legacy alias; new tasks use the three canonical levels.
export const PRIORITY_OPTIONS: TaskPriority[] = ['URGENT', 'MEDIUM', 'LOW'];
export const PRIORITY_LABELS: Record<TaskPriority, string> = { URGENT: 'Gấp', HIGH: 'Trung bình', MEDIUM: 'Trung bình', LOW: 'Thấp' };
export const normalizedPriority = (priority: TaskPriority): TaskPriority => priority === 'HIGH' ? 'MEDIUM' : priority;
const RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export function vietnamDay(now = new Date()): string {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

export function deadlineMillis(task: Pick<Task, 'due_date' | 'due_time'>): number {
  if (!task.due_date) return Infinity;
  const midnight = new Date(`${task.due_date}T00:00:00+07:00`).getTime();
  return task.due_time ? new Date(`${task.due_date}T${task.due_time}:00+07:00`).getTime() : midnight + 86400000;
}

export function isOverdue(task: Task, now = new Date()): boolean {
  return !task.is_completed && Boolean(task.due_date) && now.getTime() >= deadlineMillis(task);
}

export function overdueLabel(task: Task, now = new Date()): string {
  if (!isOverdue(task, now)) return '';
  if (!task.due_time) {
    const days = Math.round((Date.parse(vietnamDay(now)) - Date.parse(task.due_date!)) / 86400000);
    return `trễ ${days} ngày`;
  }
  const minutes = Math.floor((now.getTime() - deadlineMillis(task)) / 60000);
  if (minutes >= 1440) return `trễ ${Math.floor(minutes / 1440)} ngày`;
  if (minutes >= 60) return `trễ ${Math.floor(minutes / 60)} giờ`;
  return minutes > 0 ? `trễ ${minutes} phút` : 'vừa quá hạn';
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.is_completed !== b.is_completed) return Number(a.is_completed) - Number(b.is_completed);
    const ad = deadlineMillis(a), bd = deadlineMillis(b);
    if (ad !== bd) return ad < bd ? -1 : 1;
    return RANK[a.priority] - RANK[b.priority] || a.id.localeCompare(b.id);
  });
}

export function deadlineLabel(task: Pick<Task, 'due_date' | 'due_time'>, includeDate = false, includePrefix = true): string {
  if (!task.due_date) return includePrefix ? 'Không hạn' : '';
  const date = includeDate ? new Date(`${task.due_date}T00:00:00Z`).toLocaleDateString('vi-VN', { timeZone: 'UTC' }) : '';
  return [includePrefix ? 'Hạn' : '', date, task.due_time].filter(Boolean).join(' ');
}

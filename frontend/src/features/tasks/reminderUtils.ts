import { Task } from '../../types';
import { TaskReminder } from './types';
import { deadlineMillis, isOverdue, vietnamDay } from './deadlineUtils';

const RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export function upcomingReminders(reminders: TaskReminder[], tasks: Task[], now: Date) {
  const today = vietnamDay(now);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return reminders.filter(reminder => (reminder.due_date === today || reminder.due_date === tomorrow) && tasks.some(task =>
    task.id === reminder.task_id && task.deadline_version === reminder.deadline_version && !task.is_completed && !isOverdue(task, now)))
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || deadlineMillis(a) - deadlineMillis(b) || RANK[a.priority] - RANK[b.priority] || a.task_id.localeCompare(b.task_id));
}

export function reminderDayLabel(reminder: TaskReminder, now: Date) {
  const label = reminder.due_date === vietnamDay(now) ? 'Hôm nay' : 'Ngày mai';
  return reminder.due_time ? `${label} ${reminder.due_time}` : `${label} · Hết ngày`;
}

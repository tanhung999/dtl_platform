import { DeadlineDropTarget, shortDeadlineDate } from '../task-calendar/deadlineDropTargets';
import { Task } from '../../types';

export function resolvedDeadlineTarget(target: DeadlineDropTarget, y?: number, rect?: { top: number; height: number }): DeadlineDropTarget {
  if (target.type !== 'calendar-slot') return target;
  const base = Number(target.time!.slice(0, 2)) * 60 + Number(target.time!.slice(3));
  const offset = y === undefined || !rect ? 0 : Math.max(0, Math.min(59, (y - rect.top) / rect.height * 60));
  const minute = Math.min(1425, base + Math.round(offset / 15) * 15);
  return { ...target, time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` };
}

export function deadlineResultLabel(task: Task | undefined, target: DeadlineDropTarget): string {
  const date = shortDeadlineDate(target.date);
  if (target.type === 'calendar-slot') return `Đặt hạn ${date} ${target.time}`;
  if (target.type === 'calendar-all-day') return `Đặt hạn ${date} · cả ngày${task?.due_time ? ' (bỏ giờ)' : ''}`;
  if (task?.due_time) return `Dời sang ${date} · giữ ${task.due_time}`;
  return `${task?.due_date ? 'Dời sang' : 'Đặt hạn'} ${date} · cả ngày`;
}

import { PriorityIcon } from '../../tasks/components/PriorityIcon';
import { taskTooltip } from '../itemTooltip';
import { Lock } from 'lucide-react';
import { Task } from '../../../types';
import { useTasks } from '../../tasks/context/TasksContext';
import { deadlineLabel, isOverdue } from '../../tasks/deadlineUtils';
import '../../tasks/priority.css';

export function DeadlineRow({ task, includeDate = false }: { task: Task; includeDate?: boolean }) {
  const data = useTasks();
  const timeLabel = deadlineLabel(task, includeDate, false);
  return <div data-deadline-id={task.id} data-task-priority={task.priority} className={`calendar-deadline-row ${task.is_completed ? 'is-completed' : ''} ${isOverdue(task, data.now) ? 'is-overdue' : ''}`}>
    <input type="checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={data.busyIds.includes(task.id)} onChange={() => { data.toggle(task).catch(() => {}); }} />
    <button type="button" data-tooltip={taskTooltip(task, data.now)} aria-label={`Mở công việc ${task.title}`} onClick={() => data.edit(task)}><PriorityIcon priority={task.priority} /><span className="calendar-deadline-summary">{timeLabel && <><span className="calendar-deadline-label">{timeLabel}</span>{' '}</>}<span className="calendar-deadline-title">{task.is_private && <Lock size={12} aria-label="Riêng tư" />} {task.is_completed && '✓ '}{task.title}</span></span></button>
  </div>;
}

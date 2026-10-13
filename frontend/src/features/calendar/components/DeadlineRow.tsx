import { Task } from '../../../types';
import { useTasks } from '../../tasks/context/TasksContext';
import { deadlineLabel, isOverdue, PRIORITY_LABELS } from '../../tasks/deadlineUtils';
import '../../tasks/priority.css';
import { useId } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useDeadlineDropPending } from '../../task-calendar/TaskCalendarDndProvider';

export function DeadlineRow({ task, includeDate = false }: { task: Task; includeDate?: boolean }) {
  const data = useTasks();
  const instance = useId();
  const pending = useDeadlineDropPending();
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `deadline:${instance}:${task.id}`, data: { type: 'task', taskId: task.id, task }, disabled: pending || data.busyIds.includes(task.id) });
  return <div ref={setNodeRef} data-deadline-id={task.id} data-drag-source-id={`deadline:${instance}:${task.id}`} data-task-priority={task.priority} className={`calendar-deadline-row ${task.is_completed ? 'is-completed' : ''} ${isOverdue(task, data.now) ? 'is-overdue' : ''} ${isDragging ? 'is-dragging' : ''}`}>
    <input type="checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={data.busyIds.includes(task.id)} onChange={() => { data.toggle(task).catch(() => {}); }} />
    <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} title={`${deadlineLabel(task, true)} · ${task.title} · Ưu tiên ${PRIORITY_LABELS[task.priority]} · Kéo để đổi hạn`} aria-label={`Mở công việc ${task.title}`} onClick={() => data.edit(task)}><span className="calendar-deadline-priority-dot" role="img" aria-label={`Ưu tiên ${PRIORITY_LABELS[task.priority]}`} title={`Ưu tiên ${PRIORITY_LABELS[task.priority]}`} /><span className="calendar-deadline-label">{deadlineLabel(task, includeDate)}</span><span className="calendar-deadline-title">{task.is_completed && '✓ '}{task.title}</span></button>
  </div>;
}

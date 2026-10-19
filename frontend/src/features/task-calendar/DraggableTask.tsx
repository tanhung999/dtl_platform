import { ReactNode } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
import { Task } from '../../types';
import { useTasks } from '../tasks/context/TasksContext';
import { useDeadlineDropPending } from './TaskCalendarDndProvider';

export function DraggableTask({ task, className, children }: { task: Task; className: string; children: ReactNode }) {
  const data = useTasks();
  const pending = useDeadlineDropPending();
  const disabled = pending || data.busyIds.includes(task.id);
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `task:${task.id}`, data: { type: 'task', taskId: task.id, task }, disabled });
  return <div ref={setNodeRef} data-task-id={task.id} data-drag-source-id={`task:${task.id}`} className={`${className} ${isDragging ? 'is-dragging' : ''}`}>
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="task-calendar-drag-handle" aria-label={`Kéo ${task.title} vào lịch`} title="Kéo vào ngày trên lịch để đặt hạn" disabled={disabled}><GripVertical size={15} /></button>
    {children}
  </div>;
}

import { CSSProperties, ReactNode, useCallback, useRef } from 'react';
import { useDndContext, useDroppable } from '@dnd-kit/core';
import { DeadlineDropTarget, deadlineDropLabel } from './deadlineDropTargets';
import { useDeadlineDropPending } from './TaskCalendarDndProvider';
import { useEventDragState } from '../calendar-dnd/CalendarEventDndProvider';
import { useDragFeedback } from '../drag-feedback/DragFeedbackProvider';

interface Props { target: DeadlineDropTarget; className: string; style?: CSSProperties; onClick?: () => void; label?: string; children?: ReactNode }

export function CalendarDeadlineDropZone({ target, className, style, onClick, label, children }: Props) {
  const { active } = useDndContext();
  const pending = useDeadlineDropPending();
  const eventState = useEventDragState();
  const feedback = useDragFeedback(), node = useRef<HTMLElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: `${target.type}:${target.date}:${target.time || ''}`, data: { ...target, get node() { return node.current; } }, disabled: pending || eventState.busy });
  const ref = useCallback((value: HTMLElement | null) => { node.current = value; setNodeRef(value); }, [setNodeRef]);
  const ready = ['task', 'calendar-event'].includes(feedback.source?.type) && !pending && !eventState.busy;
  const highlighted = isOver && ready;
  const props = { ref, className: `${className} calendar-deadline-drop-zone ${ready ? 'is-drop-ready' : ''} ${highlighted ? 'is-drop-target' : ''}`, style, 'data-drop-date': target.date, 'data-drop-time': target.time, 'data-drop-type': target.type };
  const caption = highlighted && <span className="calendar-deadline-drop-caption">{feedback.label || (active?.data.current?.type === 'calendar-event' ? `Sự kiện · ${eventState.label || 'Dời ngày'}` : deadlineDropLabel(target))}</span>;
  return onClick ? <button {...props} type="button" aria-label={label} onClick={onClick}>{children}{caption}</button> : <div {...props}>{children}{caption}</div>;
}

import { ReactNode, useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { shortDeadlineDate, useDeadlineDropPending } from './TaskCalendarDndProvider';
import { useDragFeedback } from '../drag-feedback/DragFeedbackProvider';

export function CalendarDropDay({ date, className, children, label, description, selected, hasItems, onClick }: { date: string; className: string; children: ReactNode; label: string; description?: string; selected: boolean; hasItems: boolean; onClick: () => void }) {
  const pending = useDeadlineDropPending();
  const feedback = useDragFeedback(), node = useRef<HTMLButtonElement | null>(null);
  const { setNodeRef, isOver } = useDroppable({ id: `calendar-day:${date}`, data: { type: 'calendar-day', date, get node() { return node.current; } }, disabled: pending });
  const ref = useCallback((value: HTMLButtonElement | null) => { node.current = value; setNodeRef(value); }, [setNodeRef]);
  const ready = ['task', 'calendar-event'].includes(feedback.source?.type) && !pending;
  const highlighted = isOver && ready;
  return <button ref={ref} type="button" data-date={date} data-has-items={hasItems} aria-label={label} aria-description={description} aria-pressed={selected} onClick={onClick} className={`${className} calendar-drop-day ${ready ? 'is-drop-ready' : ''} ${highlighted ? 'is-drop-target' : ''}`}>
    {children}{highlighted && <span className="calendar-drop-label">{feedback.label || `Đặt hạn ${shortDeadlineDate(date)}`}</span>}
  </button>;
}

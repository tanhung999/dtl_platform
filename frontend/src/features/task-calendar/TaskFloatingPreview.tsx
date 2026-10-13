import { Task } from '../../types';
import { PriorityBadge } from '../tasks/components/PriorityBadge';
import { deadlineLabel } from '../tasks/deadlineUtils';
import { useDragFeedback } from '../drag-feedback/DragFeedbackProvider';

export function TaskFloatingPreview({ task }: { task: Task }) {
  const feedback = useDragFeedback(), original = feedback.source?.task || task;
  return <div data-feedback-preview={feedback.scope} className={`task-calendar-drag-preview drag-floating-preview ${feedback.valid === false ? 'is-invalid' : ''}`}><strong>{original.title}</strong><div className="drag-preview-meta"><PriorityBadge priority={original.priority} /><span>{deadlineLabel(original, true)}</span></div></div>;
}

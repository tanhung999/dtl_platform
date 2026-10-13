import { TaskPriority } from '../../../types';
import { PRIORITY_LABELS, PRIORITY_SYMBOLS } from '../deadlineUtils';

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <span className={`priority-tag priority-${priority}`}><span aria-hidden="true">{PRIORITY_SYMBOLS[priority]}</span>{PRIORITY_LABELS[priority]}</span>;
}
import '../priority.css';

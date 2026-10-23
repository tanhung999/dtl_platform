import { PriorityIcon } from './PriorityIcon';
import { TaskPriority } from '../../../types';
import { PRIORITY_LABELS } from '../deadlineUtils';
import '../priority.css';

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <span className={`priority-tag priority-${priority}`}><PriorityIcon priority={priority} decorative />{PRIORITY_LABELS[priority]}</span>;
}

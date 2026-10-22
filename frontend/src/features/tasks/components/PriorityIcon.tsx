import { TaskPriority } from '../../../types';
import { normalizedPriority, PRIORITY_LABELS } from '../deadlineUtils';
import '../priority.css';

export function PriorityIcon({ priority, decorative = false }: { priority: TaskPriority; decorative?: boolean }) {
  const level = normalizedPriority(priority);
  return <svg className="task-priority-icon" viewBox="0 0 16 16" role={decorative ? undefined : 'img'}
    aria-hidden={decorative || undefined} aria-label={decorative ? undefined : `Ưu tiên ${PRIORITY_LABELS[level]}`}>
    {level === 'URGENT' ? <g fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.73 2.78C7.29 1.8 8.71 1.8 9.27 2.78L14.35 11.58C14.91 12.56 14.21 13.78 13.08 13.78H2.92C1.79 13.78 1.09 12.56 1.65 11.58Z" />
      <path d="M8 6.1V8.6" strokeWidth="1.6" /><circle cx="8" cy="10.9" r=".8" fill="currentColor" stroke="none" />
    </g> : level === 'MEDIUM' ? <circle cx="8" cy="8" r="4" /> : <path d="M3 3H13L8 13Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />}
  </svg>;
}

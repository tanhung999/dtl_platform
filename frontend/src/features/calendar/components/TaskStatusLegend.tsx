import { CheckSquare } from 'lucide-react';
import { PriorityIcon } from '../../tasks/components/PriorityIcon';
import { TaskPriority } from '../../../types';

export function TaskStatusLegend() {
  return <section className="calendar-event-legend-section calendar-task-legend" aria-label="Trạng thái công việc">
    <h4>Trạng thái công việc</h4><div className="calendar-task-legend-rows">
      {([['URGENT', 'Gấp'], ['MEDIUM', 'Trung bình'], ['LOW', 'Thấp']] as [TaskPriority, string][]).map(([priority, label]) => <span key={priority} data-task-priority={priority}><PriorityIcon priority={priority} decorative />{label}</span>)}
      <span className="calendar-task-legend-completed"><CheckSquare size={14} aria-hidden="true" /><s>Đã hoàn thành</s></span>
    </div>
  </section>;
}

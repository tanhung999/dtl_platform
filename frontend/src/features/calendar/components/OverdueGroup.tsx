import { AlertCircle } from 'lucide-react';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';
import { useState } from 'react';
import { deadlineLabel, overdueLabel, vietnamDay } from '../../tasks/deadlineUtils';

export function OverdueGroup({ compact = false }: { compact?: boolean }) {
  const data = useTasks();
  const [expanded, setExpanded] = useState(true);
  if (!data.overdue.length) return null;
  if (compact) return <section className={`calendar-overdue-group calendar-overdue-compact ${data.overdue.length === 1 ? 'is-single' : ''}`} aria-label="Công việc quá hạn hôm nay">
    <div className="calendar-overdue-compact-heading"><AlertCircle size={15} /><strong>Quá hạn</strong>{data.overdue.length > 1 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{data.overdue.length} việc · {expanded ? 'Thu gọn' : 'Mở rộng'}</button>}</div>
    {(data.overdue.length === 1 || expanded) && <div className="calendar-overdue-list">{data.overdue.map(task => {
      const when = task.due_date === vietnamDay(data.now) ? `${task.due_time || 'Hết ngày'} hôm nay` : deadlineLabel(task, true).replace(/^Hạn /, '');
      return <div key={task.id} data-deadline-id={task.id} className="calendar-overdue-task"><button type="button" title={`${task.title} · ${when} · ${overdueLabel(task, data.now)}`} onClick={() => data.edit(task)}>{task.title}</button><span className="calendar-overdue-when">{when}</span><span className="calendar-overdue-separator" aria-hidden="true">·</span><span className="calendar-overdue-age">{overdueLabel(task, data.now)}</span><input type="checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={data.busyIds.includes(task.id)} onChange={() => { data.toggle(task).catch(() => {}); }} /></div>;
    })}</div>}
  </section>;
  return <section className="calendar-overdue-group" aria-label="Công việc quá hạn hôm nay"><div className="calendar-overdue-heading"><AlertCircle size={15} /><strong>Quá hạn</strong><span>{data.overdue.length} việc cần xử lý hôm nay</span></div>
    <div className="calendar-overdue-list">{data.overdue.map(task => <DeadlineRow key={task.id} task={task} includeDate />)}</div>
  </section>;
}

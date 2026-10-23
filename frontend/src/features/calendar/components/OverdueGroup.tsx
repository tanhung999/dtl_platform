import { Task } from '../../../types';
import { taskTooltip } from '../itemTooltip';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useTasks } from '../../tasks/context/TasksContext';
import { DeadlineRow } from './DeadlineRow';
import { useState } from 'react';
import { deadlineLabel, overdueLabel, vietnamDay } from '../../tasks/deadlineUtils';

export function OverdueGroup({ compact = false, items, title = 'Quá hạn' }: { compact?: boolean; items?: Task[]; title?: string }) {
  const data = useTasks();
  const [expanded, setExpanded] = useState(false);
  const tasks = items ?? data.overdue;
  const count = items ? items.length : data.counts.OVERDUE;
  const label = items ? 'Công việc quá hạn trong ngày' : 'Công việc quá hạn hôm nay';
  if (!count) return null;
  if (compact) return <section className="calendar-overdue-group calendar-overdue-compact" aria-label={label}>
    <div className="calendar-overdue-compact-heading"><span className="calendar-overdue-label"><AlertCircle size={15} /><strong>{title}</strong><span className="calendar-overdue-count">{count} việc</span></span><button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Thu gọn' : 'Mở rộng'}{expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}</button></div>
    {expanded && <div className="calendar-overdue-list">{tasks.map(task => {
      const when = task.due_date === vietnamDay(data.now) ? `${task.due_time || 'Hết ngày'} hôm nay` : deadlineLabel(task, true).replace(/^Hạn /, '');
      return <div key={task.id} data-deadline-id={task.id} className="calendar-overdue-task"><button type="button" data-tooltip={taskTooltip(task, data.now)} onClick={() => data.edit(task)}><span className="calendar-overdue-title">{task.title}</span><span className="calendar-overdue-when">{when}</span></button><span className="calendar-overdue-age">{overdueLabel(task, data.now)}</span><input type="checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={data.busyIds.includes(task.id)} onChange={() => { data.toggle(task).catch(() => {}); }} /></div>;
    })}{items === undefined && <OverduePages />}</div>}
  </section>;
  return <section className="calendar-overdue-group" aria-label={label}><div className="calendar-overdue-heading"><AlertCircle size={15} /><strong>{title}</strong><span>{count} việc cần xử lý{items === undefined ? ' hôm nay' : ''}</span></div>
    <div className="calendar-overdue-list">{tasks.map(task => <DeadlineRow key={task.id} task={task} includeDate />)}{items === undefined && <OverduePages />}</div>
  </section>;
}

function OverduePages() {
  const data = useTasks(), page = data.page;
  if (!page || data.counts.OVERDUE <= 25) return null;
  return <div className="task-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || page.overdue_offset === 0} onClick={() => data.setOverdueOffset(Math.max(0, page.overdue_offset - 25))}>Trước</button><span>{page.overdue_offset + 1}–{page.overdue_offset + data.overdue.length} / {data.counts.OVERDUE}</span><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || !page.overdue_has_more} onClick={() => data.setOverdueOffset(page.overdue_offset + 25)}>Sau</button></div>;
}

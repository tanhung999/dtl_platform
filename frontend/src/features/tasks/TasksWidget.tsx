import { TaskCreateForm } from './components/TaskCreateForm';
import { useWindowScrollMemory } from '../../services/viewMemory';
import { FeatureIcon } from '../../components/FeatureIcon';
import { taskTooltip } from '../calendar/itemTooltip';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Calendar, Eye, Lock, Pencil, Trash2 } from 'lucide-react';
import { CollectionSearch } from '../../components/CollectionSearch';
import { useTasks } from './context/TasksContext';
import { deadlineLabel, isOverdue, overdueLabel } from './deadlineUtils';
import './tasks.css';
import { PriorityBadge } from './components/PriorityBadge';
import { AnimatedCount } from '../../components/AnimatedCount';
import { ApiError } from '../../services/api';

export function TasksWidget({ fullPage = false, onOpenAll }: { fullPage?: boolean; onOpenAll?: () => void }) {
  const data = useTasks();
  const panel = useRef<HTMLDivElement>(null);
  const { filter, setFilter } = data;
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    if (!data.overdueRequest) return;
    setFilter('OVERDUE');
    const frame = requestAnimationFrame(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel.current?.focus({ preventScroll: true }); data.acknowledgeOverdue(); });
    return () => cancelAnimationFrame(frame);
  }, [data.overdueRequest]);
  const pending = data.counts.PENDING;
  const filtered = data.tasks;
  useWindowScrollMemory(`tasks/${fullPage}/${data.filter}/${data.query}/${data.page?.offset ?? 0}`, !data.loading && !!data.page);
  return <div ref={panel} tabIndex={-1} className={`glass-panel widget-box tasks-widget ${fullPage ? 'tasks-full-collection' : ''}`}>
    <div className="widget-header"><div className="widget-title"><FeatureIcon name="tasks" /><span>DT Task</span></div><span className="task-pending-badge"><AnimatedCount value={pending} /> việc chưa xong</span></div>
    {data.counts.OVERDUE > 0 && <button type="button" className="task-overdue-badge" onClick={() => setFilter('OVERDUE')}><AnimatedCount value={data.counts.OVERDUE} /> việc quá hạn</button>}
    <TaskCreateForm fullPage={fullPage} />
    {fullPage && <CollectionSearch className="tasks-search" label="Tìm công việc" placeholder="Tìm theo tiêu đề hoặc mô tả…" value={data.query} onChange={data.setQuery} />}
    {fullPage && data.query.trim().length === 1 && <p className="task-search-hint">Nhập ít nhất 2 ký tự để tìm kiếm.</p>}
    {fullPage&&<div className="task-scope-filters">{([['all','Tất cả'],['assigned_to_me','Việc của tôi'],['created_by_me','Tôi đã giao'],['following','Đang theo dõi']] as const).map(([value,label])=><button type="button" key={value} className={`btn btn-sm ${data.scope===value?'btn-secondary':'btn-outline'} ${value==='following'?'tracking-filter':''}`} onClick={()=>data.setScope(value)}>{value==='following'&&<Eye size={13}/>} {label}</button>)}</div>}
    <div className="task-filters">{([
      ['ALL', `Tất cả (${data.counts.ALL})`], ['PENDING', `Chưa làm (${pending})`],
      ['DONE', `Đã xong (${data.counts.DONE})`], ['OVERDUE', `Quá hạn (${data.counts.OVERDUE})`],
    ] as const).map(([value, label]) => <button key={value} type="button" className={`btn btn-sm ${filter === value ? 'btn-secondary' : 'btn-outline'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {(actionError || data.error) && <div className="alert-error" role="alert">{actionError || data.error}<button type="button" className="task-text-button" onClick={() => { setActionError(''); data.refresh(); }}>Thử lại</button></div>}
    {data.loading && !data.page && <p className="task-empty" role="status">Đang tải công việc…</p>}
    {!filtered.length && !data.loading ? <p className="task-empty">{fullPage && data.query ? 'Không có công việc phù hợp.' : filter === 'OVERDUE' ? 'Bạn không có việc quá hạn.' : filter === 'DONE' ? 'Chưa có công việc hoàn thành.' : 'Chưa có công việc trong nhóm này.'}</p>
      : <div className="tasks-list" aria-busy={data.loading}>{filtered.map(task => <div key={task.id} data-task-id={task.id} className={`task-item ${task.is_completed ? 'completed' : ''} ${task.is_following?'is-tracking':''} ${isOverdue(task, data.now) ? 'is-overdue' : ''}`}>
        <input type="checkbox" className="task-checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={!task.can_complete||data.busyIds.includes(task.id)} onChange={() => { setActionError(''); data.toggle(task).catch(reason => setActionError(reason.message)); }} />
        <div className="task-info"><button type="button" className="task-title-button task-title" data-tooltip={taskTooltip(task, data.now)} onClick={() => data.edit(task)}>{task.is_private && <Lock size={12} aria-label="Riêng tư" />} {task.is_completed && '✓ '}{task.title}</button>
          <div className="task-meta"><PriorityBadge priority={task.priority} />{task.is_following&&<span className="tracking-badge"><Eye size={11}/> Đang theo dõi</span>}<button type="button" className="task-deadline-button" data-tooltip={taskTooltip(task, data.now)} onClick={() => data.edit(task)}><Calendar size={11} />{deadlineLabel(task, true)}</button>{task.assignee&&<span>Người làm: {task.assignee.full_name}</span>}{isOverdue(task, data.now) && <span className="task-overdue-text">Quá hạn · {overdueLabel(task, data.now)}</span>}</div>
          {!task.due_date && task.legacy_due_date && task.deadline_version === 0 && <span className="task-legacy-hint">Cần đặt lại hạn: {task.legacy_due_date}</span>}
        </div>
        <button type="button" className="task-icon-button" aria-label={`Sửa ${task.title}`} onClick={() => data.edit(task)}><Pencil size={13} /></button>
        {task.can_delete&&<button type="button" className="task-icon-button" aria-label={`Xóa ${task.title}`} disabled={data.busyIds.includes(task.id)} onClick={async () => {
          if (!window.confirm(`Xóa công việc “${task.title}”? Hạn trên lịch và thông báo cũng sẽ được xóa.`)) return;
          try { await data.remove(task.id, task.version); } catch (reason) {
            if (reason instanceof ApiError && reason.status === 409 && reason.current && window.confirm(`Công việc vừa được cập nhật: “${reason.current.title}”. Vẫn xóa bản mới?`)) {
              try { await data.remove(task.id, reason.current.version); } catch (error) { setActionError(error instanceof Error ? error.message : 'Không thể xóa công việc.'); }
            } else setActionError(reason instanceof Error ? reason.message : 'Không thể xóa công việc.');
          }
        }}><Trash2 size={14} /></button>}
      </div>)}</div>}
    {data.page && data.page.total > data.page.limit && <div className="task-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || !data.page.offset} onClick={() => data.setOffset(Math.max(0, data.page!.offset - data.page!.limit))}>Trang trước</button><span>{data.page.offset + 1}–{data.page.offset + filtered.length} / {data.page.total}</span><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || !data.page.has_more} onClick={() => data.setOffset(data.page!.offset + data.page!.limit)}>Trang sau</button></div>}
    {!fullPage && onOpenAll && <button type="button" className="tasks-view-all" onClick={onOpenAll}><span>Xem tất cả</span><ArrowUpRight size={15} /></button>}
  </div>;
}

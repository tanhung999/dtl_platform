import { FormEvent, useEffect, useRef, useState } from 'react';
import { Calendar, CheckSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { TaskPriority } from '../../types';
import { useTasks } from './context/TasksContext';
import { deadlineLabel, isOverdue, overdueLabel, PRIORITY_LABELS } from './deadlineUtils';
import './tasks.css';
import { PriorityBadge } from './components/PriorityBadge';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { useListMotion } from '../drag-feedback/useListMotion';
import { AnimatedCount } from '../drag-feedback/AnimatedCount';
import { DraggableTask } from '../task-calendar/DraggableTask';
import { CreateAttempt } from '../../services/mutationRecovery';
import { TaskInput } from './types';
import { ApiError } from '../../services/api';

export function TasksWidget() {
  const data = useTasks();
  const panel = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const { filter, setFilter } = data;
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const createAttempt = useRef<CreateAttempt<TaskInput>>();
  useEffect(() => {
    if (!data.overdueRequest) return;
    setFilter('OVERDUE');
    const frame = requestAnimationFrame(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel.current?.focus({ preventScroll: true }); data.acknowledgeOverdue(); });
    return () => cancelAnimationFrame(frame);
  }, [data.overdueRequest]);
  const pending = data.counts.PENDING;
  const filtered = data.tasks;
  const list = useListMotion(filtered.map(task => task.id), 'data-task-id');
  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true); setActionError('');
    const payload = { title: title.trim(), priority, due_date: dueDate || null, due_time: dueTime || null };
    createAttempt.current ??= { requestId: crypto.randomUUID(), original: payload };
    try { await data.create(payload, createAttempt.current); createAttempt.current = undefined; setTitle(''); setDueDate(''); setDueTime(''); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Không thể tạo công việc.'); }
    finally { setSaving(false); }
  };
  return <div ref={panel} tabIndex={-1} className="glass-panel widget-box tasks-widget">
    <div className="widget-header"><div className="widget-title"><CheckSquare size={18} className="widget-title-icon" /><span>Việc Cần Làm (To-Do List)</span></div><span className="task-pending-badge"><AnimatedCount value={pending} /> việc chưa xong</span></div>
    {data.counts.OVERDUE > 0 && <button type="button" className="task-overdue-badge" onClick={() => setFilter('OVERDUE')}><AnimatedCount value={data.counts.OVERDUE} /> việc quá hạn</button>}
    <form onSubmit={create} className="task-quick-form">
      <div className="quick-input-bar"><input placeholder="Thêm việc cần làm mới... (Enter để tạo)" aria-label="Tên việc mới" value={title} maxLength={255} onChange={e => setTitle(e.target.value)} disabled={saving} required />
        <select aria-label="Ưu tiên việc mới" className="task-priority-select" value={priority} disabled={saving} onChange={e => setPriority(e.target.value as TaskPriority)}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving} aria-label="Tạo công việc"><Plus size={16} /></button>
      </div>
      <div className="task-quick-deadline"><div className="task-date-field"><span><Calendar size={13} /> Hạn (tùy chọn)</span><DatePicker clearLabel="Xóa hạn" label="Ngày hạn việc mới" value={dueDate} disabled={saving} onChange={value => { setDueDate(value); if (!value) setDueTime(''); }} /></div><div className="task-date-field"><span>Giờ</span><TimePicker label="Giờ hạn việc mới" value={dueTime} disabled={saving} onChange={setDueTime} /></div></div>
      {!dueDate && dueTime && <p className="task-time-default-hint">Chỉ chọn giờ: hạn vào ngày tạo công việc.</p>}
    </form>
    <div className="task-filters">{([
      ['ALL', `Tất cả (${data.counts.ALL})`], ['PENDING', `Chưa làm (${pending})`],
      ['DONE', `Đã xong (${data.counts.DONE})`], ['OVERDUE', `Quá hạn (${data.counts.OVERDUE})`],
    ] as const).map(([value, label]) => <button key={value} type="button" className={`btn btn-sm ${filter === value ? 'btn-secondary' : 'btn-outline'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {(actionError || data.error) && <div className="alert-error" role="alert">{actionError || data.error}<button type="button" className="task-text-button" onClick={() => { setActionError(''); data.refresh(); }}>Thử lại</button></div>}
    {data.loading ? <p className="task-empty">Đang tải công việc…</p> : !filtered.length ? <p className="task-empty">{filter === 'OVERDUE' ? 'Bạn không có việc quá hạn.' : filter === 'DONE' ? 'Chưa có công việc hoàn thành.' : 'Chưa có công việc trong nhóm này.'}</p>
      : <div className="tasks-list" ref={list}>{filtered.map(task => <DraggableTask key={task.id} task={task} className={`task-item ${task.is_completed ? 'completed' : ''} ${isOverdue(task, data.now) ? 'is-overdue' : ''}`}>
        <input type="checkbox" className="task-checkbox" aria-label={`Đánh dấu ${task.title}`} checked={task.is_completed} disabled={data.busyIds.includes(task.id)} onChange={() => { setActionError(''); data.toggle(task).catch(reason => setActionError(reason.message)); }} />
        <div className="task-info"><button type="button" className="task-title-button task-title" onClick={() => data.edit(task)}>{task.is_completed && '✓ '}{task.title}</button>
          <div className="task-meta"><PriorityBadge priority={task.priority} /><button type="button" className="task-deadline-button" onClick={() => data.edit(task)}><Calendar size={11} />{deadlineLabel(task, true)}</button>{isOverdue(task, data.now) && <span className="task-overdue-text">Quá hạn · {overdueLabel(task, data.now)}</span>}</div>
          {!task.due_date && task.legacy_due_date && task.deadline_version === 0 && <span className="task-legacy-hint">Cần đặt lại hạn: {task.legacy_due_date}</span>}
        </div>
        <button type="button" className="task-icon-button" aria-label={`Sửa ${task.title}`} onClick={() => data.edit(task)}><Pencil size={13} /></button>
        <button type="button" className="task-icon-button" aria-label={`Xóa ${task.title}`} disabled={data.busyIds.includes(task.id)} onClick={async () => {
          if (!window.confirm(`Xóa công việc “${task.title}”? Deadline trên lịch và nhắc hạn cũng sẽ được xóa.`)) return;
          try { await data.remove(task.id, task.version); } catch (reason) {
            if (reason instanceof ApiError && reason.status === 409 && reason.current && window.confirm(`Công việc vừa được cập nhật: “${reason.current.title}”. Vẫn xóa bản mới?`)) {
              try { await data.remove(task.id, reason.current.version); } catch (error) { setActionError(error instanceof Error ? error.message : 'Không thể xóa công việc.'); }
            } else setActionError(reason instanceof Error ? reason.message : 'Không thể xóa công việc.');
          }
        }}><Trash2 size={14} /></button>
      </DraggableTask>)}</div>}
    {data.page && data.page.total > data.page.limit && <div className="task-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || !data.page.offset} onClick={() => data.setOffset(Math.max(0, data.page!.offset - data.page!.limit))}>Trang trước</button><span>{data.page.offset + 1}–{data.page.offset + filtered.length} / {data.page.total}</span><button type="button" className="btn btn-outline btn-sm" disabled={data.loading || !data.page.has_more} onClick={() => data.setOffset(data.page!.offset + data.page!.limit)}>Trang sau</button></div>}
  </div>;
}

import { createRequestId } from '../../services/requestId';
import { useWindowScrollMemory } from '../../services/viewMemory';
import { PrioritySelect } from './components/PrioritySelect';
import { FeatureIcon } from '../../components/FeatureIcon';
import { taskTooltip } from '../calendar/itemTooltip';
import { PrivacyToggle } from '../access/PrivacyToggle';
import { MouseEvent, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Calendar, CheckCircle2, Clock, Eye, Lock, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { TaskPriority } from '../../types';
import { useTasks } from './context/TasksContext';
import { deadlineLabel, isOverdue, overdueLabel } from './deadlineUtils';
import './tasks.css';
import { PriorityBadge } from './components/PriorityBadge';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { AnimatedCount } from '../../components/AnimatedCount';
import { CreateAttempt } from '../../services/mutationRecovery';
import { TaskInput } from './types';
import { ApiError } from '../../services/api';
import { ReminderFields, ReminderValue, noReminder } from '../reminders/ReminderFields';
import { dateKey, today, parseDate, toTimestamp } from '../calendar/dateUtils';
import { UserPicker } from '../collaboration/UserPicker';
import type { UserBrief } from '../../types';

export function TasksWidget({ fullPage = false, onOpenAll }: { fullPage?: boolean; onOpenAll?: () => void }) {
  const data = useTasks();
  const panel = useRef<HTMLDivElement>(null);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [isPrivate, setIsPrivate] = useState(false);
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [reminder, setReminder] = useState<ReminderValue>(noReminder);
  const { filter, setFilter } = data;
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [assignee,setAssignee]=useState<UserBrief[]>([]);
  const [followers,setFollowers]=useState<UserBrief[]>([]);
  const createAttempt = useRef<CreateAttempt<TaskInput>>();
  const submitting = useRef(false);
  useEffect(() => {
    if (!actionSuccess) return;
    const timer = window.setTimeout(() => setActionSuccess(''), 3500);
    return () => window.clearTimeout(timer);
  }, [actionSuccess]);
  useEffect(() => {
    if (!data.overdueRequest) return;
    setFilter('OVERDUE');
    const frame = requestAnimationFrame(() => { panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel.current?.focus({ preventScroll: true }); data.acknowledgeOverdue(); });
    return () => cancelAnimationFrame(frame);
  }, [data.overdueRequest]);
  const pending = data.counts.PENDING;
  const filtered = data.tasks;
  useWindowScrollMemory(`tasks/${fullPage}/${data.filter}/${data.query}/${data.page?.offset ?? 0}`, !data.loading && !!data.page);
  const create = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!title.trim() || submitting.current || !e.currentTarget.form?.reportValidity()) return;
    submitting.current = true;
    setSaving(true); setActionError(''); setActionSuccess('');
    const payload = { title: title.trim(), priority, is_private: isPrivate, due_date: dueDate || null, due_time: dueTime || null, assignee_id:assignee[0]?.id, follower_ids:followers.map(item=>item.id), ...reminder };
    createAttempt.current ??= { requestId: createRequestId(), original: payload };
    try { await data.create(payload, createAttempt.current); createAttempt.current = undefined; setTitle(''); setAssignee([]); setFollowers([]); setIsPrivate(false); setDueDate(''); setDueTime(''); setReminder(noReminder()); setActionSuccess('Đã thêm công việc thành công.'); }
    catch (reason) { if (reason instanceof ApiError && [400, 404, 422].includes(reason.status)) createAttempt.current = undefined; setActionError(reason instanceof Error ? reason.message : 'Không thể tạo công việc.'); }
    finally { submitting.current = false; setSaving(false); }
  };
  return <div ref={panel} tabIndex={-1} className={`glass-panel widget-box tasks-widget ${fullPage ? 'tasks-full-collection' : ''}`}>
    <div className="widget-header"><div className="widget-title"><FeatureIcon name="tasks" /><span>DT Task</span></div><span className="task-pending-badge"><AnimatedCount value={pending} /> việc chưa xong</span></div>
    {data.counts.OVERDUE > 0 && <button type="button" className="task-overdue-badge" onClick={() => setFilter('OVERDUE')}><AnimatedCount value={data.counts.OVERDUE} /> việc quá hạn</button>}
    <form onSubmit={event => event.preventDefault()} className="task-quick-form">
      <div className="quick-input-bar">
        <label className="task-create-field task-create-title"><span>Tên công việc</span><input placeholder="Nhập tên công việc" aria-label="Tên việc mới" value={title} maxLength={255} onChange={e => setTitle(e.target.value)} disabled={saving} required /></label>
        <div className="task-create-field task-create-priority"><span>Ưu tiên</span><PrioritySelect label="Ưu tiên việc mới" value={priority} disabled={saving} onChange={setPriority} /></div>
      </div>
      <div className="task-quick-deadline"><div className="task-date-field"><span><Calendar size={13} /> Ngày đến hạn</span><DatePicker clearLabel="Xóa hạn" label="Ngày đến hạn" value={dueDate} disabled={saving} onChange={value => { setDueDate(value); if (!value) { setDueTime(''); if (reminder.reminder_minutes != null) setReminder(noReminder()); } }} /></div><div className="task-date-field"><span><Clock size={13} /> Giờ đến hạn</span><TimePicker label="Giờ đến hạn" value={dueTime} disabled={saving} onChange={value => { setDueTime(value); if (!value && !dueDate && reminder.reminder_minutes != null) setReminder(noReminder()); }} /></div></div>
      {!dueDate && dueTime && <p className="task-time-default-hint">Chỉ chọn giờ: hạn vào ngày tạo công việc.</p>}
      <ReminderFields allowUnscheduled value={reminder} onChange={setReminder} disabled={saving} anchor={dueDate || dueTime ? toTimestamp(parseDate(dueDate || dateKey(today())), dueTime || '00:00') : null} allDay={!dueTime} />
      <PrivacyToggle label="Công việc mới riêng tư" value={isPrivate} onChange={setIsPrivate} disabled={saving} />
      {fullPage&&<div className="people-picker-grid">
        {data.canAssignTasks&&<UserPicker label="Giao cho" endpoint="/api/task-assignees" value={assignee} onChange={setAssignee} disabled={saving}/>}
        <UserPicker multiple label="Người theo dõi" value={followers} onChange={setFollowers} disabled={saving}/>
      </div>}
      <div className="task-create-actions"><button type="button" onClick={create} className="btn btn-primary btn-sm" disabled={saving || !title.trim()}><Plus size={16} />{saving ? 'Đang thêm…' : 'Thêm công việc'}</button></div>
    </form>
    {fullPage && <label className="tasks-search"><span className="tasks-search-label"><Search size={15} aria-hidden="true" />Tìm công việc</span><input type="search" className="form-input" placeholder="Tìm theo tiêu đề hoặc mô tả…" maxLength={200} value={data.query} onChange={event => data.setQuery(event.target.value)} /></label>}
    {fullPage && data.query.trim().length === 1 && <p className="task-search-hint">Nhập ít nhất 2 ký tự để tìm kiếm.</p>}
    {fullPage&&<div className="task-scope-filters">{([['all','Tất cả'],['assigned_to_me','Việc của tôi'],['created_by_me','Tôi đã giao'],['following','Đang theo dõi']] as const).map(([value,label])=><button type="button" key={value} className={`btn btn-sm ${data.scope===value?'btn-secondary':'btn-outline'} ${value==='following'?'tracking-filter':''}`} onClick={()=>data.setScope(value)}>{value==='following'&&<Eye size={13}/>} {label}</button>)}</div>}
    <div className="task-filters">{([
      ['ALL', `Tất cả (${data.counts.ALL})`], ['PENDING', `Chưa làm (${pending})`],
      ['DONE', `Đã xong (${data.counts.DONE})`], ['OVERDUE', `Quá hạn (${data.counts.OVERDUE})`],
    ] as const).map(([value, label]) => <button key={value} type="button" className={`btn btn-sm ${filter === value ? 'btn-secondary' : 'btn-outline'}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
    {actionSuccess && <div className="access-success" role="status"><CheckCircle2 size={17} />{actionSuccess}</div>}
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

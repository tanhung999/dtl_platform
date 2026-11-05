import { MouseEvent, useEffect, useRef, useState } from 'react';
import { Calendar, Clock, Plus } from 'lucide-react';
import { TaskPriority, UserBrief } from '../../../types';
import { useTasks } from '../context/TasksContext';
import { TaskInput } from '../types';
import { PrioritySelect } from './PrioritySelect';
import { PrivacyToggle } from '../../access/PrivacyToggle';
import { DatePicker } from '../../../components/date-time/DatePicker';
import { TimePicker } from '../../../components/date-time/TimePicker';
import { ReminderFields, ReminderValue, noReminder } from '../../reminders/ReminderFields';
import { dateKey, today, parseDate, toTimestamp } from '../../calendar/dateUtils';
import { UserPicker } from '../../collaboration/UserPicker';
import { ApiError, getStoredUser } from '../../../services/api';
import { CreateAttempt } from '../../../services/mutationRecovery';
import { createRequestId } from '../../../services/requestId';

interface Props { fullPage?: boolean; modal?: boolean; initialDate?: string; initialTime?: string; onCreated?: () => void; onCancel?: () => void; onBusyChange?: (busy: boolean) => void }
export function TaskCreateForm({ fullPage = false, modal = false, initialDate = '', initialTime = '', onCreated, onCancel, onBusyChange }: Props) {
  const data = useTasks();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [isPrivate, setIsPrivate] = useState(false);
  const [hideIndirect, setHideIndirect] = useState(false);
  const [dueDate, setDueDate] = useState(initialDate);
  const [dueTime, setDueTime] = useState(initialTime);
  const [reminder, setReminder] = useState<ReminderValue>(noReminder);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [assignee,setAssignee]=useState<UserBrief[]>([]);
  const [followers,setFollowers]=useState<UserBrief[]>([]);
  const createAttempt = useRef<CreateAttempt<TaskInput>>();
  const submitting = useRef(false);
  useEffect(() => { onBusyChange?.(saving); }, [saving, onBusyChange]);
  useEffect(() => {
    if (!actionSuccess) return;
    const timer = window.setTimeout(() => setActionSuccess(''), 3500);
    return () => window.clearTimeout(timer);
  }, [actionSuccess]);
  const create = async (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!title.trim() || submitting.current || !e.currentTarget.form?.reportValidity()) return;
    submitting.current = true;
    setSaving(true); setActionError(''); setActionSuccess('');
    const payload = { title: title.trim(), ...(modal ? { description: description.trim() || null } : {}), priority, is_private: isPrivate, hide_from_indirect: hideIndirect, due_date: dueDate || null, due_time: dueTime || null, assignee_id:assignee[0]?.id, follower_ids:followers.map(item=>item.id), ...reminder };
    createAttempt.current ??= { requestId: createRequestId(), original: payload };
    try { await data.create(payload, createAttempt.current); createAttempt.current = undefined; onCreated?.(); setDescription(''); setTitle(''); setAssignee([]); setFollowers([]); setIsPrivate(false); setHideIndirect(false); setDueDate(''); setDueTime(''); setReminder(noReminder()); setActionSuccess('Đã thêm công việc thành công.'); }
    catch (reason) { if (reason instanceof ApiError && [400, 404, 422].includes(reason.status)) createAttempt.current = undefined; setActionError(reason instanceof Error ? reason.message : 'Không thể tạo công việc.'); }
    finally { submitting.current = false; setSaving(false); }
  };
  return (
    <form onSubmit={event => event.preventDefault()} className={`task-quick-form ${modal ? 'task-create-modal-form' : ''}`}>
      <fieldset disabled={saving} className="task-create-fields">
      <div className="quick-input-bar">
        <label className="task-create-field task-create-title"><span>Tên công việc</span><input placeholder="Nhập tên công việc" aria-label="Tên việc mới" value={title} autoFocus={modal} maxLength={255} onChange={e => setTitle(e.target.value)} disabled={saving} required /></label>
        <div className="task-create-field task-create-priority"><span>Ưu tiên</span><PrioritySelect label="Ưu tiên việc mới" value={priority} disabled={saving} onChange={setPriority} /></div>
      </div>
      <div className="task-quick-deadline"><div className="task-date-field"><span><Calendar size={13} /> Ngày đến hạn</span><DatePicker clearLabel="Xóa hạn" label="Ngày đến hạn" value={dueDate} disabled={saving} onChange={value => { setDueDate(value); if (!value) { setDueTime(''); if (reminder.reminder_minutes != null) setReminder(noReminder()); } }} /></div><div className="task-date-field"><span><Clock size={13} /> Giờ đến hạn</span><TimePicker label="Giờ đến hạn" value={dueTime} disabled={saving} onChange={value => { setDueTime(value); if (!value && !dueDate && reminder.reminder_minutes != null) setReminder(noReminder()); }} /></div></div>
      {!dueDate && dueTime && <p className="task-time-default-hint">Chỉ chọn giờ: hạn vào ngày tạo công việc.</p>}
      {modal && <label className="task-create-field"><span>Mô tả công việc</span><textarea className="form-input" rows={3} value={description} maxLength={10000} onChange={event => setDescription(event.target.value)} placeholder="Thêm nội dung công việc…" /></label>}
      <ReminderFields allowUnscheduled value={reminder} onChange={setReminder} disabled={saving} anchor={dueDate || dueTime ? toTimestamp(parseDate(dueDate || dateKey(today())), dueTime || '00:00') : null} allDay={!dueTime} />
      <PrivacyToggle label="Công việc mới riêng tư" value={isPrivate} onChange={setIsPrivate} hideIndirect={hideIndirect} onHideIndirect={setHideIndirect} disabled={saving} canAssign={data.canAssignTasks} />
      {fullPage&&<div className="people-picker-grid">
        {data.canAssignTasks&&<UserPicker label="Giao cho" endpoint="/api/task-assignees" value={assignee} onChange={setAssignee} disabled={saving}/>}
        <div><UserPicker multiple maxSelected={assignee[0] && assignee[0].id !== getStoredUser()?.id ? 499 : 500} label="Người theo dõi" value={followers} onChange={setFollowers} disabled={saving}/>
        </div>
      </div>}
      </fieldset>
      {actionError && <p className="alert-error task-create-error" role="alert">{actionError}</p>}
      {actionSuccess && <p className="access-success" role="status">{actionSuccess}</p>}
      <footer className="task-create-actions">{modal && <button type="button" className="btn btn-outline btn-sm" disabled={saving} onClick={onCancel}>Hủy</button>}<button type="button" onClick={create} className="btn btn-primary btn-sm" disabled={saving || !title.trim()}><Plus size={16} />{saving ? 'Đang thêm…' : 'Thêm công việc'}</button></footer>
    </form>
  );
}

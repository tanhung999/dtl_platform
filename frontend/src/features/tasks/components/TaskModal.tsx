import { PrioritySelect } from './PrioritySelect';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Task } from '../../../types';
import { TaskInput } from '../types';

import { DatePicker } from '../../../components/date-time/DatePicker';
import { TimePicker } from '../../../components/date-time/TimePicker';
import { ApiError } from '../../../services/api';
import { useMutationChecking } from '../../mutations/useMutationChecking';
import { PrivacyToggle } from '../../access/PrivacyToggle';
import { RescheduleControl } from '../../rescheduling/RescheduleControl';
import { sameFields } from '../../../services/unchanged';
import { reminderValue, sameReminder } from '../../reminders/ReminderFields';
import { UserPicker } from '../../collaboration/UserPicker';
import type { UserBrief } from '../../../types';

interface Props {
  task: Task;
  onClose: () => void;
  onSave: (id: string, payload: TaskInput) => Promise<unknown>;
  onDelete: (id: string, version?: number) => Promise<unknown>;
}

export function TaskModal({ task, onClose, onSave, onDelete }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [isPrivate, setIsPrivate] = useState(task.is_private ?? false);
  const [assignee,setAssignee]=useState<UserBrief[]>(task.assignee?[task.assignee]:[]);
  const [followers,setFollowers]=useState<UserBrief[]>((task.followers??[]).filter(item=>item.id!==task.user_id&&item.id!==task.assignee_id));
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [dueTime, setDueTime] = useState(task.due_time ?? '');
  const [reminder, setReminder] = useState(() => reminderValue(task));
  const [savedReminder, setSavedReminder] = useState(() => reminderValue(task));
  const [version, setVersion] = useState(task.version);
  const [savedDeadline, setSavedDeadline] = useState({ due_date: task.due_date, due_time: task.due_time });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState(task.version);
  const checking = useMutationChecking();
  const mounted = useRef(true), submitting = useRef(false);
  const assigneeId = task.can_assign ? assignee[0]?.id ?? task.user_id : task.assignee_id;
  const followerIds = followers.filter(user => user.id !== task.user_id && user.id !== assigneeId).map(user => user.id);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => { mounted.current = false; element?.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || confirm) return;
    if (sameFields({ title: title.trim(), description, priority, is_private: isPrivate, due_date: dueDate, due_time: dueTime, assignee_id:assigneeId, follower_ids:[...followerIds].sort() },
      { ...task, ...savedDeadline, title: task.title.trim(), is_private: task.is_private ?? false,
        follower_ids:(task.followers??[]).filter(item=>item.id!==task.user_id&&item.id!==task.assignee_id).map(item=>item.id).sort() }) && sameReminder(reminder, savedReminder)) { onClose(); return; }
    submitting.current = true; setBusy(true); setError('');
    try { await onSave(task.id, { title: title.trim(), description, priority, is_private: isPrivate, due_date: dueDate || null, due_time: dueTime || null, ...(task.can_assign ? { assignee_id: assigneeId } : {}), follower_ids:followerIds, expected_version: version, ...reminder }); if (mounted.current) onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu công việc.'); }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  const remove = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await onDelete(task.id, deleteVersion); if (mounted.current) onClose(); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.current) {
        setDeleteVersion(reason.current.version);
        setError(`Công việc vừa được cập nhật: “${reason.current.title}”. Bấm xác nhận xóa lần nữa nếu vẫn muốn xóa bản mới.`);
      } else setError(reason instanceof Error ? reason.message : 'Không thể xóa công việc.');
    }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return <dialog className="task-dialog" ref={dialog} aria-labelledby="task-dialog-title" onCancel={e => { e.preventDefault(); e.stopPropagation(); }}>
    <form onSubmit={submit} aria-busy={busy}>
      <header className="task-dialog-header"><h2 id="task-dialog-title">Chi tiết công việc</h2><button type="button" className="task-icon-button" aria-label="Đóng công việc" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <fieldset disabled={busy||confirm||!task.can_edit} className="task-dialog-fields">
        <label>Tên công việc<input className="form-input" value={title} required maxLength={255} autoFocus onChange={e => setTitle(e.target.value)} /></label>
        <div className="task-priority-field"><span>Ưu tiên</span><PrioritySelect label="Ưu tiên" value={priority} disabled={busy} onChange={setPriority} /></div>
        <div className="task-form-row"><div className="task-date-field"><span>Ngày đến hạn</span><DatePicker label="Ngày đến hạn" value={dueDate} disabled onChange={setDueDate} /></div><div className="task-date-field"><span>Giờ đến hạn</span><TimePicker label="Giờ đến hạn" value={dueTime} disabled onChange={setDueTime} /></div></div>
        <RescheduleControl kind="task" id={task.id} title={task.title} current={{ ...savedDeadline, ...savedReminder }} version={version} disabled={busy} onMoved={change => {
          setReminder(reminderValue(change.after)); setSavedReminder(reminderValue(change.after));
          setDueDate(change.after.due_date || ''); setDueTime(change.after.due_time || '');
          setSavedDeadline({ due_date: change.after.due_date ?? null, due_time: change.after.due_time ?? null });
          setVersion(change.guard.expected_version!); setDeleteVersion(change.guard.expected_version!);
        }}/>
        <label>Mô tả công việc<textarea className="form-input" rows={3} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <PrivacyToggle label="Công việc riêng tư" value={isPrivate} onChange={setIsPrivate} />
        <div className="people-picker-grid">
          {task.can_assign&&<div className="people-picker-field"><UserPicker label="Giao cho" endpoint="/api/task-assignees" value={assignee} onChange={setAssignee} disabled={busy}/>
            {!assignee.length&&<p className="people-picker-hint" role="status">Để trống sẽ giao lại cho người tạo công việc.</p>}
          </div>}
          {task.can_edit&&<UserPicker multiple label="Người theo dõi" value={followers} onChange={setFollowers} disabled={busy}/>}
        </div>
      </fieldset>
      {checking && busy && <p role="status">Đang kiểm tra lại kết quả…</p>}
      {error && <p className="alert-error task-dialog-error" role="alert">{error}</p>}
      {confirm && <div className="task-delete-confirm" role="alert"><p>Xóa công việc “{task.title}”? Hạn công việc sẽ được gỡ khỏi lịch và các thông báo còn chờ sẽ bị hủy. Thao tác này không thể hoàn tác.</p></div>}
      <footer className={`task-dialog-footer${confirm ? ' is-delete-confirm' : ''}`}>
        {confirm ? <><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirm(false)}>Giữ lại</button><button type="button" className="btn btn-danger-confirm btn-sm" disabled={busy} onClick={remove}><Trash2 size={14} />{busy ? 'Đang xóa…' : 'Xác nhận xóa'}</button></>
          : <>{task.can_delete&&<button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={14} /> Xóa công việc</button>}{task.can_edit&&<button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>{busy ? 'Đang lưu…' : 'Lưu công việc'}</button>}</>}
      </footer>
    </form>
  </dialog>;
}

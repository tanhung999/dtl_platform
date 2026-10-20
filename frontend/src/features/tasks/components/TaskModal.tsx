import { FormEvent, useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { Task, TaskPriority } from '../../../types';
import { TaskInput } from '../types';
import { PRIORITY_LABELS } from '../deadlineUtils';
import { DatePicker } from '../../../components/date-time/DatePicker';
import { TimePicker } from '../../../components/date-time/TimePicker';
import { ApiError } from '../../../services/api';
import { useMutationChecking } from '../../mutations/useMutationChecking';
import { PrivacyToggle } from '../../access/PrivacyToggle';
import { RescheduleControl } from '../../rescheduling/RescheduleControl';

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
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [dueTime, setDueTime] = useState(task.due_time ?? '');
  const [version, setVersion] = useState(task.version);
  const [savedDeadline, setSavedDeadline] = useState({ due_date: task.due_date, due_time: task.due_time });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState(task.version);
  const checking = useMutationChecking();
  const mounted = useRef(true);
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
    setBusy(true); setError('');
    try { await onSave(task.id, { title: title.trim(), description, priority, is_private: isPrivate, due_date: dueDate || null, due_time: dueTime || null, expected_version: version }); if (mounted.current) onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể lưu công việc.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await onDelete(task.id, deleteVersion); if (mounted.current) onClose(); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.current) {
        setDeleteVersion(reason.current.version);
        setError(`Công việc vừa được cập nhật: “${reason.current.title}”. Bấm xác nhận xóa lần nữa nếu vẫn muốn xóa bản mới.`);
      } else setError(reason instanceof Error ? reason.message : 'Không thể xóa công việc.');
    }
    finally { setBusy(false); }
  };
  return <dialog className="task-dialog" ref={dialog} aria-labelledby="task-dialog-title" onCancel={e => { e.preventDefault(); e.stopPropagation(); }}>
    <form onSubmit={submit}>
      <header className="task-dialog-header"><h2 id="task-dialog-title">Chi tiết công việc</h2><button type="button" className="task-icon-button" aria-label="Đóng công việc" onClick={onClose}><X size={18} /></button></header>
      <fieldset disabled={busy} className="task-dialog-fields">
        <label>Tên công việc<input className="form-input" value={title} required maxLength={255} autoFocus onChange={e => setTitle(e.target.value)} /></label>
        <label>Ưu tiên<select className="form-input" value={priority} onChange={e => setPriority(e.target.value as TaskPriority)}>{Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className="task-form-row"><div className="task-date-field"><span>Ngày hạn</span><DatePicker clearLabel="Xóa hạn" label="Ngày hạn" value={dueDate} disabled={busy} onChange={value => { setDueDate(value); if (!value) setDueTime(''); }} /></div><div className="task-date-field"><span>Giờ hạn (tùy chọn)</span><TimePicker label="Giờ hạn (tùy chọn)" value={dueTime} disabled={busy} onChange={setDueTime} /></div></div>
        <div className="task-deadline-help"><span>{!dueDate && dueTime ? 'Chỉ chọn giờ: hạn vào ngày tạo công việc.' : 'Giờ Việt Nam · Không đặt giờ: hết ngày mới quá hạn.'}</span>{dueDate && <button type="button" className="task-text-button" onClick={() => { setDueDate(''); setDueTime(''); }}>Xóa hạn</button>}</div>
        <label>Mô tả công việc<textarea className="form-input" rows={3} maxLength={10000} value={description} onChange={e => setDescription(e.target.value)} /></label>
        <PrivacyToggle label="Công việc riêng tư" value={isPrivate} onChange={setIsPrivate} />
        <RescheduleControl kind="task" id={task.id} title={task.title} current={savedDeadline} version={version} disabled={busy} onMoved={change => {
          setDueDate(change.after.due_date || ''); setDueTime(change.after.due_time || '');
          setSavedDeadline({ due_date: change.after.due_date ?? null, due_time: change.after.due_time ?? null });
          setVersion(change.guard.expected_version!); setDeleteVersion(change.guard.expected_version!);
        }}/>
      </fieldset>
      {checking && busy && <p role="status">Đang kiểm tra lại kết quả…</p>}
      {error && <p className="alert-error task-dialog-error" role="alert">{error}</p>}
      {confirm && <div className="task-delete-confirm" role="alert"><p>Xóa công việc “{task.title}”? Deadline trên lịch và nhắc hạn cũng sẽ được xóa.</p><div><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirm(false)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={remove}>Xác nhận xóa công việc</button></div></div>}
      <footer className="task-dialog-footer"><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => setConfirm(true)}><Trash2 size={14} /> Xóa công việc</button><button type="submit" className="btn btn-primary btn-sm" disabled={busy || confirm || !title.trim()}>{busy ? 'Đang lưu…' : 'Lưu công việc'}</button></footer>
    </form>
  </dialog>;
}

import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCheck, X } from 'lucide-react';
import type { Task } from '../../../types';

export function TaskCompletionDialog({ task, onSave, onClose }: {
  task: Task; onSave: (note: string) => Promise<void>; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), submitting = useRef(false);
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement as HTMLElement | null;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    try { await onSave(note.trim()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Chưa cập nhật được kết quả. Nội dung bạn nhập vẫn được giữ.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className="task-dialog task-completion-dialog" aria-labelledby="completion-title"
    onCancel={event => { event.preventDefault(); event.stopPropagation(); if (!busy) onClose(); }}>
    <form onSubmit={submit} aria-busy={busy}>
      <header className="task-dialog-header"><h2 id="completion-title"><CheckCheck size={20} />Cập nhật kết quả</h2>
        <button type="button" className="task-icon-button" aria-label="Đóng cập nhật kết quả" disabled={busy} onClick={onClose}><X size={18} /></button></header>
      <div className="task-dialog-content"><p className="task-completion-title">{task.title}</p>
      <textarea className="form-input task-completion-note" aria-label="Nội dung cập nhật kết quả" aria-describedby="completion-hint" autoFocus rows={3} maxLength={500} value={note}
        disabled={busy} placeholder="Nhập kết quả, ví dụ: Đã gửi báo cáo…" onChange={event => setNote(event.target.value)} />
      <div className="task-completion-meta"><small id="completion-hint">Không bắt buộc</small><small className="task-completion-counter">{note.length}/500 ký tự</small></div>
      {error && <p role="alert" className="alert-error">{error}</p>}
      </div><footer className="task-dialog-footer"><button type="button" className="btn btn-outline" disabled={busy} onClick={onClose}>Hủy</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Đang cập nhật…' : 'Cập nhật và hoàn thành'}</button></footer>
    </form>
  </dialog>, document.body);
}

import { useEffect, useRef, useState } from 'react';
import { ClipboardList, X } from 'lucide-react';
import { TaskCreateForm } from './TaskCreateForm';
import '../tasks.css';

export function TaskCreateDialog({ date, time = '', onClose }: { date: string; time?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="task-dialog task-create-dialog" aria-labelledby="task-create-heading" onCancel={event => { event.preventDefault(); }}>
    <header className="task-dialog-header"><h2 id="task-create-heading"><ClipboardList size={19} />Thêm công việc</h2><button type="button" disabled={busy} className="calendar-icon-button" aria-label="Đóng form thêm công việc" onClick={onClose}><X size={20} /></button></header>
    <TaskCreateForm fullPage modal initialDate={date} initialTime={time} onCreated={onClose} onCancel={onClose} onBusyChange={setBusy} />
  </dialog>;
}

import { useEffect, useRef } from 'react';
import { CalendarPlus, ClipboardList, ChevronRight, X } from 'lucide-react';
import { useDialogDismiss } from '../../../components/useDialogDismiss';

export function AddCalendarDialog({ onEvent, onTask, onClose }: { onEvent: () => void; onTask: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const dismiss = useDialogDismiss(onClose);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} {...dismiss} className="calendar-add-dialog" aria-labelledby="calendar-add-title">
    <header><h2 id="calendar-add-title">Thêm lịch</h2><button type="button" className="calendar-icon-button" aria-label="Đóng lựa chọn thêm lịch" onClick={onClose}><X size={20} /></button></header>
    <div className="calendar-add-options">
      <button type="button" onClick={onEvent}><span className="calendar-add-icon"><CalendarPlus size={23} /></span><span><strong>Thêm sự kiện</strong><small>Cuộc họp, lịch hẹn hoặc hoạt động</small></span><ChevronRight size={18} /></button>
      <button type="button" onClick={onTask}><span className="calendar-add-icon is-task"><ClipboardList size={23} /></span><span><strong>Thêm công việc</strong><small>Đặt hạn, giao việc và theo dõi</small></span><ChevronRight size={18} /></button>
    </div>
  </dialog>;
}

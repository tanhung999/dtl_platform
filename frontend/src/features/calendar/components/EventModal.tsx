import { CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, Lock, MapPin, Trash2, X } from 'lucide-react';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../dateUtils';
import { CalendarEvent, CalendarEventInput, EventDraft } from '../types';
import { EventStatusBadge, EventStatusLegend } from './EventStatusBadge';
import { useTasks } from '../../tasks/context/TasksContext';
import { eventStatus } from '../eventStatus';
import { CreateAttempt } from '../../../services/mutationRecovery';
import { ApiError } from '../../../services/api';
import { useMutationChecking } from '../../mutations/useMutationChecking';
import { DatePicker } from '../../../components/date-time/DatePicker';
import { TimePicker } from '../../../components/date-time/TimePicker';

interface Props {
  event?: CalendarEvent;
  draft: EventDraft;
  onClose: () => void;
  onSave: (payload: CalendarEventInput, id?: string, attempt?: CreateAttempt<CalendarEventInput>) => Promise<void>;
  onDelete: (id: string, updatedAt: string) => Promise<void>;
}

export function EventModal({ event, draft, onClose, onSave, onDelete }: Props) {
  const { now } = useTasks();
  const status = event && eventStatus(event, now, dateKey(draft.date));
  const dialog = useRef<HTMLDialogElement>(null);
  const initialHour = draft.hour ?? 9;
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [isPrivate, setIsPrivate] = useState(event?.is_private ?? false);
  const [allDay, setAllDay] = useState(event?.is_all_day ?? draft.allDay ?? false);
  const [startDate, setStartDate] = useState(dateKey(event ? eventDate(event.starts_at) : draft.date));
  const [endDate, setEndDate] = useState(dateKey(event
    ? eventDate(event.is_all_day ? new Date(new Date(event.ends_at).getTime() - 1).toISOString() : event.ends_at)
    : addDays(draft.date, initialHour === 23 && !draft.allDay ? 1 : 0)));
  const [startTime, setStartTime] = useState(event ? eventTime(event.starts_at) : `${String(initialHour).padStart(2, '0')}:00`);
  const [endTime, setEndTime] = useState(event ? eventTime(event.ends_at) : `${String((initialHour + 1) % 24).padStart(2, '0')}:00`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const attempt = useRef<CreateAttempt<CalendarEventInput>>();
  const [deleteVersion, setDeleteVersion] = useState(event?.updated_at);
  const checking = useMutationChecking();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const element = dialog.current;
    element?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      mounted.current = false;
      element?.close();
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!title.trim()) { setError('Vui lòng nhập tên sự kiện.'); return; }
    if (!startDate || !endDate || (!allDay && (!startTime || !endTime))) { setError('Vui lòng chọn đầy đủ ngày và giờ của sự kiện.'); return; }
    const starts = toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime);
    const ends = allDay ? toTimestamp(addDays(parseDate(endDate), 1)) : toTimestamp(parseDate(endDate), endTime);
    if (ends <= starts) { setError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    setBusy(true);
    try {
      const payload: CalendarEventInput = { title: title.trim(), description, location, starts_at: starts, ends_at: ends, is_all_day: allDay, is_private: isPrivate, color: event?.color ?? '#2563eb', ...(event ? { expected_updated_at: event.updated_at } : {}) };
      if (!event) attempt.current ??= { requestId: crypto.randomUUID(), original: payload };
      await onSave(payload, event?.id, attempt.current);
      if (mounted.current) onClose();
    } catch (reason) {
      if (!event && reason instanceof ApiError && [400, 404, 422].includes(reason.status)) attempt.current = undefined;
      setError(reason instanceof Error ? reason.message : 'Không thể lưu sự kiện.');
    } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!event || busy) return;
    setBusy(true);
    setError('');
    try { await onDelete(event.id, deleteVersion!); if (mounted.current) onClose(); }
    catch (reason) {
      if (reason instanceof ApiError && reason.status === 409 && reason.current) {
        setDeleteVersion(reason.current.updated_at);
        setError(`Sự kiện vừa được cập nhật: “${reason.current.title}”. Bấm xác nhận xóa lần nữa nếu vẫn muốn xóa bản mới.`);
      } else setError(reason instanceof Error ? reason.message : 'Không thể xóa sự kiện.');
    }
    finally { setBusy(false); }
  };

  return (
    <dialog ref={dialog} className="calendar-event-dialog" aria-labelledby="calendar-dialog-title"
      onCancel={e => { e.preventDefault(); onClose(); }}>
      <form onSubmit={submit}>
        <header className="calendar-dialog-header">
          <div><span className="calendar-eyebrow">LỊCH CÁ NHÂN</span><h2 id="calendar-dialog-title">{event ? 'Chi tiết sự kiện' : 'Tạo sự kiện mới'}</h2></div>
          <button type="button" className="calendar-icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <fieldset disabled={busy} className="calendar-dialog-fields">
          {status && <div style={{ '--event-color': status.color } as CSSProperties}><EventStatusBadge status={status} /></div>}
          <label className="calendar-field">Tên sự kiện
            <input className="form-input calendar-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Thêm tiêu đề" required maxLength={200} autoFocus />
          </label>
          <label className="calendar-checkbox"><input type="checkbox" checked={allDay} onChange={e => {
            setAllDay(e.target.checked);
            if (!e.target.checked) { setStartTime('09:00'); setEndTime('10:00'); }
          }} /> Sự kiện cả ngày</label>
          <div className="calendar-form-row">
            <div className="calendar-field"><span><CalendarDays size={15} /> Ngày bắt đầu</span><DatePicker label="Ngày bắt đầu" value={startDate} required disabled={busy} onChange={value => { setStartDate(value); if (value > endDate) setEndDate(value); }} /></div>
            <div className="calendar-field"><span><CalendarDays size={15} /> Ngày kết thúc</span><DatePicker label="Ngày kết thúc" value={endDate} min={startDate} required disabled={busy} align="end" onChange={setEndDate} /></div>
          </div>
          {!allDay && <div className="calendar-form-row">
            <div className="calendar-field"><span><Clock size={15} /> Giờ bắt đầu</span><TimePicker label="Giờ bắt đầu" value={startTime} required disabled={busy} onChange={setStartTime} /></div>
            <div className="calendar-field"><span><Clock size={15} /> Giờ kết thúc</span><TimePicker label="Giờ kết thúc" value={endTime} required disabled={busy} onChange={setEndTime} /></div>
          </div>}
          <p className="calendar-muted">{allDay ? 'Bao gồm cả ngày bắt đầu và ngày kết thúc.' : 'Giờ Việt Nam (UTC+7)'}</p>
          <label className="calendar-field"><span><MapPin size={15} /> Địa điểm</span><input className="form-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="Thêm địa điểm" maxLength={255} /></label>
          <label className="calendar-field">Mô tả<textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ghi chú cho sự kiện…" rows={3} maxLength={10000} /></label>
          <label className="calendar-checkbox"><input type="checkbox" role="switch" aria-label="Sự kiện riêng tư" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)} /><Lock size={15} /> Riêng tư</label>
          <p className="calendar-muted">{isPrivate ? 'Chỉ bạn nhìn thấy sự kiện này. Người được chia sẻ lịch không nhìn thấy.' : 'Người được cấp quyền xem sự kiện trong lịch có thể nhìn thấy mục này.'}</p>
          <div className="calendar-field"><span>Màu tự đổi theo thời gian</span><EventStatusLegend /></div>
        </fieldset>
        {checking && busy && <p role="status">Đang kiểm tra lại kết quả…</p>}
        {error && <p className="alert-error calendar-dialog-error" role="alert">{error}</p>}
        {confirmDelete && <div className="calendar-delete-confirm" role="alert">
          <p>Xóa sự kiện “{event?.title}”? Thao tác này không thể hoàn tác.</p>
          <div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={remove}>{busy ? 'Đang xóa…' : 'Xác nhận xóa'}</button></div>
        </div>}
        <footer className="calendar-dialog-footer">
          {event && <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Xóa</button>}
          <div className="calendar-inline-actions"><button type="button" className="btn btn-outline" onClick={onClose}>Hủy</button><button type="submit" className="btn btn-primary" disabled={busy || confirmDelete}>{busy ? 'Đang lưu…' : 'Lưu sự kiện'}</button></div>
        </footer>
      </form>
    </dialog>
  );
}

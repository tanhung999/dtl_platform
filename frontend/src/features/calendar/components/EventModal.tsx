import { RecurrenceScopePicker, occurrenceFor, type ScopeSelection, type RecurrenceScope } from './RecurrenceScope';
import { RecurrenceSelect } from './RecurrenceSelect';
import { CSSProperties, FormEvent, useEffect, useRef, useState } from 'react';
import { CalendarDays, Clock, MapPin, Trash2, X } from 'lucide-react';
import { PrivacyToggle } from '../../access/PrivacyToggle';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../dateUtils';
import { CalendarEvent, CalendarEventInput, EventDraft, Recurrence } from '../types';
import { EventStatusBadge, EventStatusLegend } from './EventStatusBadge';
import { useTasks } from '../../tasks/context/TasksContext';
import { eventStatus } from '../eventStatus';
import { isUncertainFailure, MutationUncertainError } from '../../../services/mutationRecovery';
import { CreateAttempt } from '../../../services/mutationRecovery';
import { ApiError } from '../../../services/api';
import { useMutationChecking } from '../../mutations/useMutationChecking';
import { DatePicker } from '../../../components/date-time/DatePicker';
import { TimePicker } from '../../../components/date-time/TimePicker';
import { RescheduleControl } from '../../rescheduling/RescheduleControl';
import { sameFields } from '../../../services/unchanged';
import { ReminderFields, reminderValue, sameReminder } from '../../reminders/ReminderFields';

interface Props {
  event?: CalendarEvent;
  draft: EventDraft;
  onClose: () => void;
  onSave: (payload: CalendarEventInput, id?: string, attempt?: CreateAttempt<CalendarEventInput>) => Promise<void>;
  onDelete: (id: string, updatedAt: string, selection?: ScopeSelection) => Promise<void>;
}

export function EventModal({ event, draft, onClose, onSave, onDelete }: Props) {
  const { now } = useTasks();
  const dialog = useRef<HTMLDialogElement>(null);
  const initialHour = draft.hour ?? 9;
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [isPrivate, setIsPrivate] = useState(event?.is_private ?? false);
  const [recurrence, setRecurrence] = useState<Recurrence>(event?.recurrence ?? 'NONE');
  const [allDay, setAllDay] = useState(event?.is_all_day ?? draft.allDay ?? false);
  const [reminder, setReminder] = useState(() => reminderValue(event ?? {}));
  const [savedReminder, setSavedReminder] = useState(() => reminderValue(event ?? {}));
  const [startDate, setStartDate] = useState(dateKey(event ? eventDate(event.starts_at) : draft.date));
  const [endDate, setEndDate] = useState(dateKey(event
    ? eventDate(event.is_all_day ? new Date(new Date(event.ends_at).getTime() - 1).toISOString() : event.ends_at)
    : draft.date));
  const [startTime, setStartTime] = useState(event ? eventTime(event.starts_at) : `${String(initialHour).padStart(2, '0')}:00`);
  const [endTime, setEndTime] = useState(event ? eventTime(event.ends_at) : initialHour === 23 ? '23:30' : `${String(initialHour + 1).padStart(2, '0')}:00`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scopedMoved, setScopedMoved] = useState(false);
  const [deleteScope, setDeleteScope] = useState<RecurrenceScope>('THIS');
  const [occurrenceAt, setOccurrenceAt] = useState(() => event ? occurrenceFor(event.starts_at, event.recurrence, draft.occurrenceAt) : undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteUncertain, setDeleteUncertain] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<CreateAttempt<CalendarEventInput>>();
  const [deleteVersion, setDeleteVersion] = useState(event?.updated_at);
  const [updatedAt, setUpdatedAt] = useState(event?.updated_at);
  const [savedSchedule, setSavedSchedule] = useState({ starts_at: event?.starts_at, ends_at: event?.ends_at, is_all_day: event?.is_all_day, recurrence: event?.recurrence });
  const recurring = !!event && ((savedSchedule.recurrence ?? 'NONE') !== 'NONE' || event.recurrence === 'NONE' && !!event.series_recurrence);
  const status = event && eventStatus({ ...event, starts_at: savedSchedule.starts_at!, ends_at: savedSchedule.ends_at!, recurrence: savedSchedule.recurrence }, now,
    updatedAt !== event.updated_at ? startDate : dateKey(draft.date));
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
    if (submitting.current || confirmDelete || deleteUncertain) return;
    setError('');
    if (!title.trim()) { setError('Vui lòng nhập tên sự kiện.'); return; }
    if (!startDate || !endDate || (!allDay && (!startTime || !endTime))) { setError('Vui lòng chọn đầy đủ ngày và giờ của sự kiện.'); return; }
    const sameStart = !!event && allDay === savedSchedule.is_all_day && startDate === dateKey(eventDate(savedSchedule.starts_at!)) && (allDay || startTime === eventTime(savedSchedule.starts_at!));
    const sameEnd = !!event && allDay === savedSchedule.is_all_day && endDate === dateKey(eventDate(allDay ? new Date(Date.parse(savedSchedule.ends_at!) - 1).toISOString() : savedSchedule.ends_at!)) && (allDay || endTime === eventTime(savedSchedule.ends_at!));
    const starts = sameStart ? savedSchedule.starts_at! : toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime);
    const ends = sameEnd ? savedSchedule.ends_at! : allDay ? toTimestamp(addDays(parseDate(endDate), 1)) : toTimestamp(parseDate(endDate), endTime);
    if (event && recurrence === (savedSchedule.recurrence ?? 'NONE') && sameStart && sameEnd && sameReminder(reminder, savedReminder) && sameFields({ title: title.trim(), description: description.trim(), location: location.trim(), is_private: isPrivate },
      { ...event, title: event.title.trim(), description: (event.description ?? '').trim(), location: (event.location ?? '').trim(), is_private: event.is_private ?? false })) { onClose(); return; }
    if (Date.parse(ends) <= Date.parse(starts)) { setError('Thời gian kết thúc phải sau thời gian bắt đầu.'); return; }
    submitting.current = true; setBusy(true);
    try {
      const payload: CalendarEventInput = { title: title.trim(), description, location, starts_at: starts, ends_at: ends, is_all_day: allDay, recurrence, is_private: isPrivate, color: event?.color ?? '#2563eb', ...reminder, ...(event ? { expected_updated_at: updatedAt } : {}) };
      if (!event) attempt.current ??= { requestId: crypto.randomUUID(), original: payload };
      await onSave(payload, event?.id, attempt.current);
      if (mounted.current) onClose();
    } catch (reason) {
      if (!event && reason instanceof ApiError && [400, 404, 422].includes(reason.status)) attempt.current = undefined;
      setError(reason instanceof Error ? reason.message : 'Không thể lưu sự kiện.');
    } finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };

  const remove = async () => {
    if (!event || submitting.current || deleteUncertain || scopedMoved) return;
    submitting.current = true; setBusy(true);
    setError('');
    try { await onDelete(event.id, deleteVersion!, recurring ? {scope:deleteScope, occurrence_at:occurrenceAt!} : undefined); if (mounted.current) onClose(); }
    catch (reason) {
      if (isUncertainFailure(reason) || reason instanceof MutationUncertainError) {
        setDeleteUncertain(true);
        setError('Chưa xác nhận được kết quả xóa. Đóng chi tiết và kiểm tra lại lịch trước khi thao tác tiếp.');
      } else if (reason instanceof ApiError && reason.status === 409 && reason.current) {
        setDeleteVersion(reason.current.updated_at);
        setError(`Sự kiện vừa được cập nhật: “${reason.current.title}”. Bấm xác nhận xóa lần nữa nếu vẫn muốn xóa bản mới.`);
      } else setError(reason instanceof Error ? reason.message : 'Không thể xóa sự kiện.');
    }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };

  return (
    <dialog ref={dialog} className="calendar-event-dialog" aria-labelledby="calendar-dialog-title"
      onCancel={e => { e.preventDefault(); e.stopPropagation(); }}>
      <form onSubmit={submit} aria-busy={busy}>
        <header className="calendar-dialog-header">
          <div><span className="calendar-eyebrow">LỊCH CÁ NHÂN</span><h2 id="calendar-dialog-title">{event ? 'Chi tiết sự kiện' : 'Tạo sự kiện mới'}</h2></div>
          <button type="button" className="calendar-icon-button" onClick={onClose} disabled={busy} aria-label="Đóng"><X size={20} /></button>
        </header>
        <fieldset disabled={busy} className="calendar-dialog-fields">
          {status && <div style={{ '--event-color': status.color } as CSSProperties}><EventStatusBadge status={status} /></div>}
          <label className="calendar-field">Tên sự kiện
            <input className="form-input calendar-title-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Thêm tiêu đề" required maxLength={200} autoFocus />
          </label>
          <label className="calendar-checkbox"><input type="checkbox" checked={allDay} disabled={busy || !!event} onChange={e => {
            setAllDay(e.target.checked); setEndDate(startDate);
            if (!e.target.checked) { setStartTime('09:00'); setEndTime('10:00'); }
          }} /> Sự kiện cả ngày</label>
          <div className="calendar-form-row">
            <div className="calendar-field"><span><CalendarDays size={15} /> Ngày bắt đầu</span><DatePicker label="Ngày bắt đầu" value={startDate} required disabled={busy || !!event} onChange={value => { setStartDate(value); if (!allDay || value > endDate) setEndDate(value); }} /></div>
            {allDay && <div className="calendar-field"><span><CalendarDays size={15} /> Ngày kết thúc</span><DatePicker label="Ngày kết thúc" value={endDate} min={startDate} required disabled={busy || !!event} align="end" onChange={setEndDate}/></div>}
          </div>
          {!allDay && <div className="calendar-form-row">
            <div className="calendar-field"><span><Clock size={15} /> Giờ bắt đầu</span><TimePicker label="Giờ bắt đầu" value={startTime} required disabled={busy || !!event} onChange={value => { setStartTime(value); setEndDate(startDate); }} /></div>
            <div className="calendar-field"><span><Clock size={15} /> Giờ kết thúc</span><TimePicker label="Giờ kết thúc" value={endTime} required disabled={busy || !!event} onChange={value => { setEndTime(value); setEndDate(startDate); }} /></div>
          </div>}

          <RecurrenceSelect startDate={startDate} value={recurrence} disabled={busy || !!event} onChange={value => { setRecurrence(value); if (!allDay) setEndDate(startDate); }}/>
          {event && <p className="calendar-repeat-help">Chọn “Dời lịch / Thông báo” để thay đổi lịch hoặc cài đặt thông báo.</p>}
          {scopedMoved && <p className="calendar-repeat-help">Đã cập nhật phần lịch đã chọn. Lưu nội dung nếu cần, rồi đóng và mở lại sự kiện để dời hoặc xóa tiếp.</p>}
          {event && <RescheduleControl occurrenceAt={occurrenceAt} seriesRecurrence={savedSchedule.recurrence !== 'NONE' ? savedSchedule.recurrence : event.recurrence === 'NONE' ? event.series_recurrence : undefined} onScoped={() => { setScopedMoved(true); setConfirmDelete(false); }} kind="event" id={event.id} title={event.title} current={{ ...savedSchedule, ...savedReminder }} updatedAt={updatedAt} disabled={busy || scopedMoved} onMoved={change => {
            if (occurrenceAt && savedSchedule.starts_at) setOccurrenceAt(new Date(Date.parse(occurrenceAt) + Date.parse(change.after.starts_at!) - Date.parse(savedSchedule.starts_at)).toISOString());
            setReminder(reminderValue(change.after)); setSavedReminder(reminderValue(change.after));
            setSavedSchedule({ starts_at: change.after.starts_at!, ends_at: change.after.ends_at!, is_all_day: change.after.is_all_day!, recurrence: change.after.recurrence });
            setRecurrence(change.after.recurrence ?? recurrence);
            setStartDate(dateKey(eventDate(change.after.starts_at!))); setStartTime(eventTime(change.after.starts_at!));
            setEndDate(dateKey(eventDate(change.after.is_all_day ? new Date(Date.parse(change.after.ends_at!) - 1).toISOString() : change.after.ends_at!)));
            setEndTime(eventTime(change.after.ends_at!)); setAllDay(!!change.after.is_all_day); setUpdatedAt(change.guard.expected_updated_at); setDeleteVersion(change.guard.expected_updated_at);
          }}/>}
          <label className="calendar-field"><span><MapPin size={15} /> Địa điểm</span><input className="form-input" value={location} onChange={e => setLocation(e.target.value)} placeholder="Thêm địa điểm" maxLength={255} /></label>
          <label className="calendar-field">Mô tả<textarea className="form-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Ghi chú cho sự kiện…" rows={3} maxLength={10000} /></label>
          <PrivacyToggle label="Sự kiện riêng tư" value={isPrivate} onChange={setIsPrivate} />
          {!event && <ReminderFields recurrence={recurrence} value={reminder} onChange={setReminder} anchor={startDate && (allDay || startTime) ? toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime) : null} endsAt={endDate && (allDay || endTime) ? toTimestamp(allDay ? addDays(parseDate(endDate), 1) : parseDate(endDate), allDay ? '00:00' : endTime) : null} allDay={allDay} disabled={busy} />}

          <div className="calendar-field"><span>Màu tự đổi theo thời gian</span><EventStatusLegend /></div>
        </fieldset>
        {checking && busy && <p role="status">Đang kiểm tra lại kết quả…</p>}
        {error && <p className="alert-error calendar-dialog-error" role="alert">{error}</p>}
        {confirmDelete && <div className="calendar-delete-confirm" role="alert">
          {!scopedMoved && recurring && <RecurrenceScopePicker action="delete" at={occurrenceAt!} value={deleteScope} onChange={setDeleteScope} disabled={busy || deleteUncertain} />}
          <p>{recurring ? 'Các lần đã chọn và thông báo tương ứng sẽ bị xóa. Các phần còn lại được giữ nguyên.' : event?.deletion_includes_series ? `Mục này thuộc một chuỗi lịch. Xóa sẽ xóa cả chuỗi chứa “${event.title}” và các thông báo còn chờ.` : `Xóa sự kiện “${event?.title}”?`} Thao tác này không thể hoàn tác.</p>
          <div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy || deleteUncertain} onClick={remove}>{busy ? 'Đang xóa…' : 'Xác nhận xóa'}</button></div>
        </div>}
        <footer className="calendar-dialog-footer">
          {event && <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy || scopedMoved || deleteUncertain} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Xóa</button>}
          <div className="calendar-inline-actions"><button type="submit" className="btn btn-primary" disabled={busy || confirmDelete || deleteUncertain}>{busy ? 'Đang lưu…' : 'Lưu sự kiện'}</button></div>
        </footer>
      </form>
    </dialog>
  );
}

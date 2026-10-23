import { RecurrenceScopePicker, occurrenceFor, type RecurrenceScope } from '../calendar/components/RecurrenceScope';
import { RecurrenceSelect } from '../calendar/components/RecurrenceSelect';
import type { Recurrence } from '../calendar/types';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, History, X } from 'lucide-react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';
import { Change, history, Kind, move, MoveInput, notifyMoved, Schedule } from './api';
import { scheduleLabel, sameScheduleFields, notificationLabel } from './labels';
import { showMoved } from './RescheduleToast';
import { isUncertainFailure } from '../../services/mutationRecovery';
import './rescheduling.css';
import { ReminderFields, reminderValue, sameReminder } from '../reminders/ReminderFields';

interface Props { eventId?: string; seriesRecurrence?: Recurrence | null; occurrenceAt?: string; onScoped?: () => void; kind: Kind; id: string; title: string; current: Schedule; version?: number; updatedAt?: string; disabled?: boolean; onMoved: (value: Change) => void }
export function RescheduleControl(props: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const undone = (event: Event) => { const change = (event as CustomEvent<Change>).detail;
    if (change.kind !== props.kind || change.resource_id !== props.id || !change.current || !change.current_guard) return;
    if (props.version !== undefined && change.current_guard.expected_version !== undefined && change.current_guard.expected_version < props.version) return;
    if (props.updatedAt && change.current_guard.expected_updated_at && Date.parse(change.current_guard.expected_updated_at) < Date.parse(props.updatedAt)) return;
    props.onMoved({ ...change, after: change.current, guard: change.current_guard }); };
    window.addEventListener('schedule:undone', undone); return () => window.removeEventListener('schedule:undone', undone); }, [props.kind, props.id, props.onMoved]);
  const label = 'Dời lịch / Thông báo';
  return <><button type="button" className="btn btn-outline btn-sm reschedule-open" disabled={props.disabled} onClick={() => setOpen(true)}><CalendarClock size={15}/>{label}</button>
    {open && <MoveDialog {...props} label={label} onClose={() => setOpen(false)}/>}</>;
}

function MoveDialog({ kind, id, title, current, version, updatedAt, eventId, seriesRecurrence, occurrenceAt, onScoped, onMoved, label, onClose }: Props & { label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), mounted = useRef(true), attempt = useRef<MoveInput>();
  const task = kind === 'task';
  const unscheduledNote = kind === 'note' && !current.starts_at;
  const recurring = !task && !unscheduledNote && (!!seriesRecurrence && seriesRecurrence !== 'NONE' || !!current.recurrence && current.recurrence !== 'NONE');
  const at = !task && !unscheduledNote ? occurrenceFor(current.starts_at!, current.recurrence, occurrenceAt) : undefined;
  const [scope, setScope] = useState<RecurrenceScope>('THIS');
  const effective = recurring && scope !== 'ALL' ? {...current, starts_at:at, ends_at:new Date(Date.parse(at!) + Date.parse(current.ends_at!) - Date.parse(current.starts_at!)).toISOString()} : current;
  const [reminder, setReminder] = useState(() => reminderValue(current));
  const [startDate, setStartDate] = useState(task ? current.due_date || '' : unscheduledNote ? '' : dateKey(eventDate(effective.starts_at!)));
  const [startTime, setStartTime] = useState(task ? current.due_time || '' : unscheduledNote ? '' : eventTime(current.starts_at!));
  const [allDay, setAllDay] = useState(task ? !current.due_time : !!current.is_all_day);
  const [endDate, setEndDate] = useState(task ? startDate : unscheduledNote ? '' : dateKey(eventDate(effective.is_all_day ? new Date(Date.parse(effective.ends_at!) - 1).toISOString() : effective.ends_at!)));
  const [recurrence, setRecurrence] = useState<Recurrence>(seriesRecurrence ?? current.recurrence ?? 'NONE');
  const [endTime, setEndTime] = useState(task || unscheduledNote ? '' : eventTime(current.ends_at!));
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [tab, setTab] = useState<'move' | 'history'>('move'), [entries, setEntries] = useState<Change[]>(), [historyError, setHistoryError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { mounted.current = true; const node = ref.current, previous = document.activeElement as HTMLElement; node?.showModal(); return () => { mounted.current = false; node?.close(); previous?.focus(); }; }, []);
  useEffect(() => { if (tab !== 'history') return; const controller = new AbortController(); setEntries(undefined); setHistoryError('');
    history(kind, id, controller.signal).then(value => { if (!controller.signal.aborted) setEntries(value); }).catch(value => { if (!controller.signal.aborted) setHistoryError(value.message); });
    return () => controller.abort(); }, [tab, kind, id, retry]);
  const shift = (day: string, time = startTime) => {
    setStartDate(day); setStartTime(time);
    if (task || !day || (!allDay && !time)) return;
    const span = allDay && startDate && endDate ? (parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 86400000 : 0;
    const days = Number.isFinite(span) ? Math.max(0, span) : 0;
    setEndDate(dateKey(addDays(parseDate(day), days)));
  };
  const changeAllDay = (value: boolean) => {
    setAllDay(value);
    if (value) return;
    setEndDate(startDate);
    setStartTime(task ? current.due_time || '09:00' : !current.is_all_day && current.starts_at ? eventTime(current.starts_at) : '09:00');
    setEndTime(!task && !current.is_all_day && current.ends_at ? eventTime(current.ends_at) : '10:00');
  };
  let target: Schedule | undefined = unscheduledNote ? {} : task && !startDate && allDay ? {due_date:null,due_time:null} : undefined;
  if (startDate && (task || endDate && (allDay || startTime && endTime))) {
    if (task) target = { due_date: startDate, due_time: allDay ? null : startTime || null };
    else {
      const starts_at = toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime);
      const ends_at = allDay ? toTimestamp(addDays(parseDate(endDate), 1)) : toTimestamp(parseDate(endDate), endTime);
      if (Date.parse(ends_at) > Date.parse(starts_at)) target = { starts_at, ends_at, is_all_day: allDay, recurrence: recurring && scope === 'THIS' ? 'NONE' : recurrence };
    }
  }
  if (target) target = { ...target, ...reminder };
  const scheduleChanged = !unscheduledNote && !!target && (task ? target.due_date !== (current.due_date || null) || target.due_time !== (current.due_time || null)
    : Date.parse(target.starts_at!) !== Date.parse(effective.starts_at!) || Date.parse(target.ends_at!) !== Date.parse(effective.ends_at!) || target.is_all_day !== !!current.is_all_day || recurrence !== (seriesRecurrence ?? current.recurrence ?? 'NONE'));
  const changed = !!target && (scheduleChanged || !sameReminder(reminder, current));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation(); if (busy || !target || !changed) return;
    attempt.current ??= { ...target, request_id: crypto.randomUUID(), ...(recurring ? {scope, occurrence_at:at} : {}), reason: reason.trim(), ...(version !== undefined ? { expected_version: version } : {}), ...(updatedAt ? { expected_updated_at: updatedAt } : {}) };
    setBusy(true); setError('');
    try { const result = await move(kind, id, attempt.current); notifyMoved(kind); showMoved(result); if (result.guard.scoped && result.current && result.current_guard) { onMoved({...result, after:result.current, guard:result.current_guard}); onScoped?.(); } else onMoved(result); if (mounted.current) onClose(); }
    catch (value) { const unknown = isUncertainFailure(value); if (!unknown) attempt.current = undefined; if (mounted.current) { setError((value as Error).message); setUncertain(unknown); } }
    finally { if (mounted.current) setBusy(false); }
  };
  return createPortal(<dialog ref={ref} className="reschedule-dialog" aria-label={label} onCancel={event => { event.preventDefault(); event.stopPropagation(); }}>
    <header><div><h2>{label}</h2><p title={title}>{title}</p></div><button type="button" className="task-icon-button" aria-label="Đóng dời lịch" onClick={onClose}><X size={20}/></button></header>
    <div className="reschedule-tabs"><button type="button" aria-pressed={tab === 'move'} onClick={() => setTab('move')}>{label}</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}><History size={14}/>Lịch sử</button></div>
    {tab === 'history' ? <section className="reschedule-history"><p className="reschedule-help">Chỉ bạn xem được lịch sử này. Hiển thị tối đa 20 lần gần nhất.</p>
      {historyError ? <p role="alert">{historyError}<button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></p> : !entries ? <p role="status">Đang tải lịch sử…</p> : !entries.length ? <p>Chưa có thay đổi nào.</p> : entries.map(entry => <article key={entry.id}><p>{sameScheduleFields(entry.before, entry.after) ? <>Thông báo: {notificationLabel(entry.before)} <span aria-label="sang">→</span> {notificationLabel(entry.after)}</> : <>{scheduleLabel(entry.before)} <span aria-label="sang">→</span> {scheduleLabel(entry.after)}</>}</p><p>{entry.reason || 'Không nhập lý do'}</p><small>{kind !== 'task' && (entry.guard.scoped || entry.guard.family || entry.before.recurrence && entry.before.recurrence !== 'NONE') && `${(entry.guard.scoped?.scope ?? entry.guard.family?.scope) === 'THIS' ? 'Chỉ lần này' : (entry.guard.scoped?.scope ?? entry.guard.family?.scope) === 'FOLLOWING' ? 'Lần này và các lần sau' : 'Cả chuỗi'} · `}{entry.actor_name} · {new Date(entry.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}{entry.undone_at ? ' · Đã hoàn tác' : ''}</small></article>)}</section>
      : <form onSubmit={submit}><fieldset disabled={busy || uncertain}>
        {recurring && <RecurrenceScopePicker action="move" at={at!} value={scope} disabled={busy || uncertain} onChange={value => { setScope(value); const origin = value === 'ALL' ? current.starts_at! : at!; setStartDate(dateKey(eventDate(origin))); setEndDate(dateKey(eventDate(new Date(Date.parse(origin) + Date.parse(current.ends_at!) - Date.parse(current.starts_at!) - (current.is_all_day ? 1 : 0)).toISOString()))); }} />}
        {!unscheduledNote && <>
        <label className="reschedule-all-day"><input type="checkbox" checked={allDay} onChange={event => changeAllDay(event.target.checked)}/>{task ? 'Hạn cả ngày (không đặt giờ)' : 'Cả ngày'}</label>
        <div className={`reschedule-range-row ${(task ? allDay : !allDay) ? 'is-single' : ''}`}>
          <div className="reschedule-field"><span>{task ? 'Ngày đến hạn mới' : 'Ngày bắt đầu mới'}</span><DatePicker label={task ? 'Ngày đến hạn mới' : 'Ngày bắt đầu mới'} value={startDate} required={!task || !allDay || !!current.due_date} disabled={busy || uncertain} onChange={value => shift(value)}/></div>
          {task && !allDay && <div className="reschedule-field"><span>Giờ đến hạn mới</span><TimePicker label="Giờ đến hạn mới" value={startTime} required disabled={busy || uncertain} onChange={value => shift(startDate, value)}/></div>}
          {!task && allDay && <div className="reschedule-field"><span>Ngày kết thúc mới</span><DatePicker label="Ngày kết thúc mới" value={endDate} min={startDate} required disabled={busy || uncertain} align="end" onChange={setEndDate}/></div>}
        </div>
        {!task && !allDay && <div className="reschedule-range-row">
          <div className="reschedule-field"><span>Giờ bắt đầu mới</span><TimePicker label="Giờ bắt đầu mới" value={startTime} required disabled={busy || uncertain} onChange={value => shift(startDate, value)}/></div>
          <div className="reschedule-field"><span>Giờ kết thúc mới</span><TimePicker label="Giờ kết thúc mới" value={endTime} required disabled={busy || uncertain} onChange={value => { setEndTime(value); setEndDate(startDate); }}/></div>
        </div>}
        {!task && !(recurring && scope === 'THIS') && <RecurrenceSelect startDate={startDate} value={recurrence} disabled={busy || uncertain} onChange={value => { setRecurrence(value); if (!allDay) setEndDate(startDate); }}/>}

        </>}
        {unscheduledNote && <p className="reschedule-help">Ghi chú chưa gắn vào lịch. Bạn chỉ có thể đặt thông báo tại đây.</p>}
        <ReminderFields eventId={recurring && scope === 'ALL' && !scheduleChanged && current.recurrence !== 'NONE' ? kind === 'event' ? id : eventId : undefined} allowUnscheduled={unscheduledNote || task && !startDate} recurrence={task ? undefined : recurring && scope === 'THIS' ? 'NONE' : recurrence} value={reminder} onChange={setReminder} anchor={target && (allDay || startTime) ? task ? startDate ? toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime) : null : target.starts_at : null} endsAt={task ? undefined : target?.ends_at} allDay={allDay} disabled={busy || uncertain} />
        {reminder.reminder_at && <p className="reschedule-help">Giờ thông báo tùy chỉnh được giữ nguyên khi đổi lịch. Hãy kiểm tra hoặc chọn lại trước khi xác nhận.</p>}
        {!task && startDate && endDate && (allDay || startTime && endTime) && !target && <p role="alert" className="reschedule-error">{allDay ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : 'Giờ kết thúc phải sau giờ bắt đầu.'}</p>}
        <label>Lý do thay đổi <span className="reschedule-help">(không bắt buộc)</span><textarea className="form-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Chờ bổ sung hồ sơ…"/></label><small className="reschedule-help">{reason.length}/500</small>
      </fieldset>{error && <p role="alert" className="reschedule-error">{error}</p>}<footer><button type="submit" className="btn btn-primary" disabled={busy || !target || !changed}>{busy ? 'Đang áp dụng…' : uncertain ? 'Thử áp dụng lại' : 'Áp dụng'}</button></footer></form>}
  </dialog>, document.body);
}

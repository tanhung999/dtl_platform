import { createRequestId } from '../../services/requestId';
import { RecurrenceScopePicker, occurrenceFor, type RecurrenceScope } from '../calendar/components/RecurrenceScope';
import { RecurrenceSelect } from '../calendar/components/RecurrenceSelect';
import type { Recurrence } from '../calendar/types';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, History, X } from 'lucide-react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';
import { Change, history, Kind, move, MoveInput, notifyMoved, Schedule, hydrateEditor } from './api';
import { ScheduleHistory } from './ScheduleHistory';
import { showMoved } from './RescheduleToast';
import { isUncertainFailure } from '../../services/mutationRecovery';
import './rescheduling.css';
import '../../components/dialog-section-tabs.css';
import { ReminderFields, reminderValue, sameReminder } from '../reminders/ReminderFields';

interface Props { eventId?: string; seriesRecurrence?: Recurrence | null; occurrenceAt?: string; kind: Kind; id: string; title: string; current: Schedule; version?: number; updatedAt?: string; disabled?: boolean; onMoved: (value: Change) => void }
export function RescheduleControl(props: Props) {
  const [open, setOpen] = useState(false);
  const applied = useRef<string>();
  useEffect(() => { const undone = (event: Event) => { const change = (event as CustomEvent<Change>).detail;
    if (change.kind !== props.kind || (change.resource_id !== props.id && change.id !== applied.current) || !change.current || !change.current_guard) return;
    if (change.resource_id === props.id && props.version !== undefined && change.current_guard.expected_version !== undefined && change.current_guard.expected_version < props.version) return;
    if (change.resource_id === props.id && props.updatedAt && change.current_guard.expected_updated_at && Date.parse(change.current_guard.expected_updated_at) < Date.parse(props.updatedAt)) return;
    props.onMoved({ ...change, after: change.current, guard: change.current_guard }); };
    window.addEventListener('schedule:undone', undone); return () => window.removeEventListener('schedule:undone', undone); }, [props.kind, props.id, props.onMoved]);
  const label = 'Dời lịch / Thông báo';
  return <><button type="button" className="btn btn-outline btn-sm reschedule-open" disabled={props.disabled} onClick={() => setOpen(true)}><CalendarClock size={15}/>{label}</button>
    {open && <MoveDialog {...props} onMoved={change => { props.onMoved(change); applied.current = change.id; }} label={label} onClose={() => setOpen(false)}/>}</>;
}

function MoveDialog({ kind, id, title, current, version, updatedAt, eventId, seriesRecurrence, occurrenceAt, onMoved, label, onClose }: Props & { label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), mounted = useRef(true), attempt = useRef<MoveInput>(), committed = useRef<Change>(), submitting = useRef(false);
  const task = kind === 'task';
  const unscheduledNote = kind === 'note' && !current.starts_at;
  const recurring = !task && !unscheduledNote && (!!seriesRecurrence && seriesRecurrence !== 'NONE' || !!current.recurrence && current.recurrence !== 'NONE');
  const at = !task && !unscheduledNote ? occurrenceFor(current.starts_at!, current.recurrence, occurrenceAt) : undefined;
  const [scope, setScope] = useState<RecurrenceScope>(recurring ? 'FOLLOWING' : 'ALL');
  const effective = recurring && scope !== 'ALL' ? {...current, starts_at:at, ends_at:new Date(Date.parse(at!) + Date.parse(current.ends_at!) - Date.parse(current.starts_at!)).toISOString()} : current;
  const [reminder, setReminder] = useState(() => reminderValue(current));
  const [startDate, setStartDate] = useState(task ? current.due_date || '' : unscheduledNote ? '' : dateKey(eventDate(effective.starts_at!)));
  const [startTime, setStartTime] = useState(task ? current.due_time || '' : unscheduledNote ? '' : eventTime(current.starts_at!));
  const [allDay, setAllDay] = useState(task ? !current.due_time : !!current.is_all_day);
  const [endDate, setEndDate] = useState(task ? startDate : unscheduledNote ? '' : dateKey(eventDate(effective.is_all_day ? new Date(Date.parse(effective.ends_at!) - 1).toISOString() : effective.ends_at!)));
  const [recurrence, setRecurrence] = useState<Recurrence>(seriesRecurrence ?? current.recurrence ?? 'NONE');
  const [endTime, setEndTime] = useState(task || unscheduledNote ? '' : eventTime(current.ends_at!));
  const modeDrafts = useRef<Partial<Record<'allDay' | 'timed', { startDate: string; endDate: string; startTime: string; endTime: string }>>>({});
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [syncFailed, setSyncFailed] = useState(false);
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
    modeDrafts.current[allDay ? 'allDay' : 'timed'] = { startDate, endDate, startTime, endTime };
    setAllDay(value);
    const saved = modeDrafts.current[value ? 'allDay' : 'timed'];
    if (saved) {
      setStartDate(saved.startDate); setEndDate(saved.endDate); setStartTime(saved.startTime); setEndTime(saved.endTime);
      return;
    }
    if (value) return;
    setEndDate(startDate);
    setStartTime(task ? current.due_time || '09:00' : !current.is_all_day && current.starts_at ? eventTime(current.starts_at) : '09:00');
    setEndTime(!task && !current.is_all_day && current.ends_at ? eventTime(current.ends_at) : '10:00');
  };
  let target: Schedule | undefined = unscheduledNote ? {} : task && !startDate && allDay ? {due_date:null,due_time:null} : undefined;
  if (startDate && (task || endDate && (allDay || startTime && endTime))) {
    if (task) target = { due_date: startDate, due_time: allDay ? null : startTime || null };
    else {
      const sameStart = allDay === !!effective.is_all_day && startDate === dateKey(eventDate(effective.starts_at!)) && (allDay || startTime === eventTime(effective.starts_at!));
      const sameEnd = allDay === !!effective.is_all_day && endDate === dateKey(eventDate(new Date(Date.parse(effective.ends_at!) - (allDay ? 1 : 0)).toISOString())) && (allDay || endTime === eventTime(effective.ends_at!));
      const starts_at = sameStart ? effective.starts_at! : toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime);
      const ends_at = sameEnd ? effective.ends_at! : allDay ? toTimestamp(addDays(parseDate(endDate), 1)) : toTimestamp(parseDate(endDate), endTime);
      if (Date.parse(ends_at) > Date.parse(starts_at)) target = { starts_at, ends_at, is_all_day: allDay, recurrence: recurring && scope === 'THIS' ? 'NONE' : recurrence };
    }
  }
  const displayedReminder = recurring && scope === 'THIS' ? { ...reminder, reminder_repeat: false,
    ...(current.reminder_repeat && reminder.reminder_at && reminder.reminder_at === current.reminder_at && startDate ? { reminder_at: toTimestamp(parseDate(startDate), eventTime(reminder.reminder_at)) } : {}) } : reminder;
  if (target) target = { ...target, ...displayedReminder, ...(!task && !unscheduledNote ? { reminder_repeat: target.recurrence !== 'NONE' && !!displayedReminder.reminder_repeat } : {}) };
  const scheduleChanged = !unscheduledNote && !!target && (task ? target.due_date !== (current.due_date || null) || target.due_time !== (current.due_time || null)
    : Date.parse(target.starts_at!) !== Date.parse(effective.starts_at!) || Date.parse(target.ends_at!) !== Date.parse(effective.ends_at!) || target.is_all_day !== !!current.is_all_day || recurrence !== (seriesRecurrence ?? current.recurrence ?? 'NONE'));
  const changed = !!target && (scheduleChanged || !sameReminder(reminder, current));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation(); if (submitting.current || !target || !changed) return;
    submitting.current = true;
    attempt.current ??= { ...target, request_id: createRequestId(), ...(recurring ? {scope, occurrence_at:at} : {}), reason: reason.trim(), ...(version !== undefined ? { expected_version: version } : {}), ...(updatedAt ? { expected_updated_at: updatedAt } : {}) };
    setBusy(true); setError('');
    try {
      committed.current ??= await move(kind, id, attempt.current);
      const result = await hydrateEditor(committed.current);
      onMoved(result); notifyMoved(kind); showMoved(result);
      if (mounted.current) onClose();
    }
    catch (value) { const unknown = isUncertainFailure(value); if (!unknown && !committed.current) attempt.current = undefined; if (mounted.current) { setError((value as Error).message); setUncertain(unknown && !committed.current); setSyncFailed(!!committed.current); } }
    finally { submitting.current = false; if (mounted.current) setBusy(false); }
  };
  return createPortal(<dialog ref={ref} className="reschedule-dialog" aria-label={label} onCancel={event => { event.preventDefault(); event.stopPropagation(); }}>
    <header><div><h2>{label}</h2><p title={title}>{title}</p></div><button type="button" className="task-icon-button" aria-label="Đóng dời lịch" disabled={busy || syncFailed} onClick={onClose}><X size={20}/></button></header>
    <div className="dialog-section-tabs reschedule-tabs"><button type="button" aria-pressed={tab === 'move'} onClick={() => setTab('move')}>{label}</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}><History size={14}/>Lịch sử</button></div>
    {tab === 'history' ? <ScheduleHistory kind={kind} entries={entries} error={historyError} onRetry={() => setRetry(value => value + 1)} />
      : <form onSubmit={submit} aria-busy={busy}><fieldset disabled={busy || uncertain || syncFailed}>
        {recurring && <RecurrenceScopePicker action="move" at={at!} value={scope} disabled={busy || uncertain || syncFailed} onChange={value => { setScope(value); modeDrafts.current = {}; const origin = value === 'ALL' ? current.starts_at! : at!; setStartDate(dateKey(eventDate(origin))); setEndDate(dateKey(eventDate(new Date(Date.parse(origin) + Date.parse(current.ends_at!) - Date.parse(current.starts_at!) - (current.is_all_day ? 1 : 0)).toISOString()))); }} />}
        {!unscheduledNote && <>
        <label className="reschedule-all-day"><input type="checkbox" checked={allDay} onChange={event => changeAllDay(event.target.checked)}/>{task ? 'Hạn cả ngày (không đặt giờ)' : 'Cả ngày'}</label>
        <div className={`reschedule-range-row ${(task ? allDay : !allDay) ? 'is-single' : ''}`}>
          <div className="reschedule-field"><span>{task ? 'Ngày đến hạn mới' : 'Ngày bắt đầu mới'}</span><DatePicker label={task ? 'Ngày đến hạn mới' : 'Ngày bắt đầu mới'} value={startDate} required={!task || !allDay || !!current.due_date} disabled={busy || uncertain || syncFailed} onChange={value => shift(value)}/></div>
          {task && !allDay && <div className="reschedule-field"><span>Giờ đến hạn mới</span><TimePicker label="Giờ đến hạn mới" value={startTime} required disabled={busy || uncertain || syncFailed} onChange={value => shift(startDate, value)}/></div>}
          {!task && allDay && <div className="reschedule-field"><span>Ngày kết thúc mới</span><DatePicker label="Ngày kết thúc mới" value={endDate} min={startDate} required disabled={busy || uncertain || syncFailed} align="end" onChange={setEndDate}/></div>}
        </div>
        {!task && !allDay && <div className="reschedule-range-row">
          <div className="reschedule-field"><span>Giờ bắt đầu mới</span><TimePicker label="Giờ bắt đầu mới" value={startTime} required disabled={busy || uncertain || syncFailed} onChange={value => shift(startDate, value)}/></div>
          <div className="reschedule-field"><span>Giờ kết thúc mới</span><TimePicker label="Giờ kết thúc mới" value={endTime} required disabled={busy || uncertain || syncFailed} onChange={value => { setEndTime(value); setEndDate(startDate); }}/></div>
        </div>}
        {!task && !(recurring && scope === 'THIS') && <RecurrenceSelect startDate={startDate} value={recurrence} disabled={busy || uncertain || syncFailed} onChange={value => { setRecurrence(value); setReminder(previous => ({ ...previous, reminder_repeat: value === (seriesRecurrence ?? current.recurrence ?? 'NONE') ? !!current.reminder_repeat : value !== 'NONE' })); if (!allDay) setEndDate(startDate); }}/>}

        </>}
        {unscheduledNote && <p className="reschedule-help">Ghi chú chưa gắn vào lịch. Bạn chỉ có thể đặt thông báo tại đây.</p>}
        <ReminderFields eventId={recurring && scope === 'ALL' && !scheduleChanged && current.recurrence !== 'NONE' ? kind === 'event' ? id : eventId : undefined} allowUnscheduled={unscheduledNote || task && !startDate} recurrence={task ? undefined : recurring && scope === 'THIS' ? 'NONE' : recurrence} value={displayedReminder} onChange={setReminder} anchor={target && (allDay || startTime) ? task ? startDate ? toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime) : null : target.starts_at : null} endsAt={task ? undefined : target?.ends_at} allDay={allDay} disabled={busy || uncertain || syncFailed} />
        {reminder.reminder_at && !displayedReminder.reminder_repeat && <p className="reschedule-help">Ngày giờ thông báo đã chọn không tự đổi theo lịch mới. Hãy kiểm tra lại trước khi áp dụng.</p>}
        {!task && startDate && endDate && (allDay || startTime && endTime) && !target && <p role="alert" className="reschedule-error">{allDay ? 'Ngày kết thúc phải từ ngày bắt đầu trở đi.' : 'Giờ kết thúc phải sau giờ bắt đầu.'}</p>}
        <label>Lý do thay đổi <span className="reschedule-help">(không bắt buộc)</span><textarea className="form-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Chờ bổ sung hồ sơ…"/></label><small className="reschedule-help">{reason.length}/500</small>
      </fieldset>{error && <p role="alert" className="reschedule-error">{syncFailed ? 'Lịch đã được lưu nhưng chưa tải được chi tiết mới. Giữ nguyên nội dung và bấm “Thử đồng bộ lại” để tiếp tục.' : uncertain ? 'Chưa nhận được xác nhận. Giữ nguyên form và bấm “Thử áp dụng lại” để kiểm tra, không tạo thay đổi trùng.' : error}</p>}<footer><button type="submit" className="btn btn-primary" disabled={busy || !target || !changed}>{busy ? 'Đang áp dụng…' : syncFailed ? 'Thử đồng bộ lại' : uncertain ? 'Thử áp dụng lại' : 'Áp dụng'}</button></footer></form>}
  </dialog>, document.body);
}

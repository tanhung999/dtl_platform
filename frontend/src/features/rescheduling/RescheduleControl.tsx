import { FormEvent, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarClock, History, X } from 'lucide-react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { addDays, dateKey, eventDate, eventTime, parseDate, today, toTimestamp } from '../calendar/dateUtils';
import { Change, history, Kind, move, MoveInput, notifyMoved, Schedule } from './api';
import { scheduleLabel } from './labels';
import { showMoved } from './RescheduleToast';
import { isUncertainFailure } from '../../services/mutationRecovery';
import './rescheduling.css';

interface Props { kind: Kind; id: string; title: string; current: Schedule; version?: number; updatedAt?: string; disabled?: boolean; onMoved: (value: Change) => void }
export function RescheduleControl(props: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const undone = (event: Event) => { const change = (event as CustomEvent<Change>).detail;
    if (change.kind !== props.kind || change.resource_id !== props.id || !change.current || !change.current_guard) return;
    if (props.version !== undefined && change.current_guard.expected_version !== undefined && change.current_guard.expected_version < props.version) return;
    if (props.updatedAt && change.current_guard.expected_updated_at && Date.parse(change.current_guard.expected_updated_at) < Date.parse(props.updatedAt)) return;
    props.onMoved({ ...change, after: change.current, guard: change.current_guard }); };
    window.addEventListener('schedule:undone', undone); return () => window.removeEventListener('schedule:undone', undone); }, [props.kind, props.id, props.onMoved]);
  const label = props.kind === 'task' ? props.current.due_date ? 'Đổi hạn' : 'Đặt hạn' : 'Dời lịch';
  return <><button type="button" className="btn btn-outline btn-sm reschedule-open" disabled={props.disabled} onClick={() => setOpen(true)}><CalendarClock size={15}/>{label}</button>
    {open && <MoveDialog {...props} label={label} onClose={() => setOpen(false)}/>}</>;
}

function MoveDialog({ kind, id, title, current, version, updatedAt, onMoved, label, onClose }: Props & { label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null), mounted = useRef(true), attempt = useRef<MoveInput>();
  const task = kind === 'task';
  const [startDate, setStartDate] = useState(task ? current.due_date || dateKey(today()) : dateKey(eventDate(current.starts_at!)));
  const [startTime, setStartTime] = useState(task ? current.due_time || '' : eventTime(current.starts_at!));
  const [allDay, setAllDay] = useState(task ? !current.due_time : !!current.is_all_day);
  const [endDate, setEndDate] = useState(task ? startDate : dateKey(eventDate(current.is_all_day ? new Date(Date.parse(current.ends_at!) - 1).toISOString() : current.ends_at!)));
  const [endTime, setEndTime] = useState(task ? '' : eventTime(current.ends_at!));
  const [reason, setReason] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [tab, setTab] = useState<'move' | 'history'>('move'), [entries, setEntries] = useState<Change[]>(), [historyError, setHistoryError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => { mounted.current = true; const node = ref.current, previous = document.activeElement as HTMLElement; node?.showModal(); return () => { mounted.current = false; node?.close(); previous?.focus(); }; }, []);
  useEffect(() => { if (tab !== 'history') return; const controller = new AbortController(); setEntries(undefined); setHistoryError('');
    history(kind, id, controller.signal).then(value => { if (!controller.signal.aborted) setEntries(value); }).catch(value => { if (!controller.signal.aborted) setHistoryError(value.message); });
    return () => controller.abort(); }, [tab, kind, id, retry]);
  const shift = (day: string, time = startTime) => {
    setStartDate(day); setStartTime(time);
    if (task || !day || (!allDay && !time)) return;
    const duration = Date.parse(current.ends_at!) - Date.parse(current.starts_at!);
    const days = Math.max(1, Math.ceil(duration / 86400000));
    if (allDay) setEndDate(dateKey(addDays(parseDate(day), days - 1)));
    else { const end = new Date(Date.parse(toTimestamp(parseDate(day), time)) + duration).toISOString(); setEndDate(dateKey(eventDate(end))); setEndTime(eventTime(end)); }
  };
  let target: Schedule | undefined;
  if (startDate && (task || endDate && (allDay || startTime && endTime))) {
    if (task) target = { due_date: startDate, due_time: allDay ? null : startTime || null };
    else {
      const starts_at = toTimestamp(parseDate(startDate), allDay ? '00:00' : startTime);
      const ends_at = allDay ? toTimestamp(addDays(parseDate(endDate), 1)) : toTimestamp(parseDate(endDate), endTime);
      if (Date.parse(ends_at) > Date.parse(starts_at)) target = { starts_at, ends_at, is_all_day: allDay };
    }
  }
  const changed = !!target && (task ? target.due_date !== current.due_date || target.due_time !== (current.due_time || null)
    : Date.parse(target.starts_at!) !== Date.parse(current.starts_at!) || Date.parse(target.ends_at!) !== Date.parse(current.ends_at!) || target.is_all_day !== !!current.is_all_day);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation(); if (busy || !target || !changed) return;
    attempt.current ??= { ...target, request_id: crypto.randomUUID(), reason: reason.trim(), ...(version !== undefined ? { expected_version: version } : {}), ...(updatedAt ? { expected_updated_at: updatedAt } : {}) };
    setBusy(true); setError('');
    try { const result = await move(kind, id, attempt.current); notifyMoved(kind); showMoved(result); onMoved(result); if (mounted.current) onClose(); }
    catch (value) { const unknown = isUncertainFailure(value); if (!unknown) attempt.current = undefined; if (mounted.current) { setError((value as Error).message); setUncertain(unknown); } }
    finally { if (mounted.current) setBusy(false); }
  };
  return createPortal(<dialog ref={ref} className="reschedule-dialog" aria-label={label} onCancel={event => { event.preventDefault(); event.stopPropagation(); }}>
    <header><div><h2>{label}</h2><p title={title}>{title}</p></div><button type="button" className="task-icon-button" aria-label="Đóng dời lịch" onClick={onClose}><X size={20}/></button></header>
    <div className="reschedule-tabs"><button type="button" aria-pressed={tab === 'move'} onClick={() => setTab('move')}>{label}</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}><History size={14}/>Lịch sử</button></div>
    {tab === 'history' ? <section className="reschedule-history"><p className="reschedule-help">Chỉ bạn xem được lịch sử này. Hiển thị tối đa 20 lần gần nhất.</p>
      {historyError ? <p role="alert">{historyError}<button type="button" onClick={() => setRetry(value => value + 1)}>Thử lại</button></p> : !entries ? <p role="status">Đang tải lịch sử…</p> : !entries.length ? <p>Chưa có lần dời lịch nào.</p> : entries.map(entry => <article key={entry.id}><p>{scheduleLabel(entry.before)} <span aria-label="sang">→</span> {scheduleLabel(entry.after)}</p><p>{entry.reason || 'Không nhập lý do'}</p><small>{entry.actor_name} · {new Date(entry.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}{entry.undone_at ? ' · Đã hoàn tác' : ''}</small></article>)}</section>
      : <form onSubmit={submit}><fieldset disabled={busy || uncertain}>
        <div className="reschedule-quick">{[[1, 'Ngày mai'], [7, 'Tuần sau']].map(([offset, text]) => { const value = dateKey(addDays(today(), Number(offset))); return <button key={value} type="button" className="btn btn-outline btn-sm" onClick={() => shift(value)}>{text} · {value.split('-').reverse().join('/')}</button>; })}</div>
        <label>{task ? 'Ngày hạn mới' : 'Ngày bắt đầu mới'}<DatePicker label={task ? 'Ngày hạn mới' : 'Ngày bắt đầu mới'} value={startDate} required disabled={busy || uncertain} onChange={value => shift(value)}/></label>
        <label className="reschedule-all-day"><input type="checkbox" checked={allDay} onChange={event => { const value = event.target.checked; setAllDay(value); if (!value) { setStartTime(current.starts_at ? eventTime(current.starts_at) : current.due_time || '09:00'); setEndTime(current.ends_at ? eventTime(current.ends_at) : '10:00'); } }}/>{task ? 'Hạn cả ngày (không đặt giờ)' : 'Cả ngày'}</label>
        {!allDay && <label>{task ? 'Giờ hạn mới' : 'Giờ bắt đầu mới'}<TimePicker label={task ? 'Giờ hạn mới' : 'Giờ bắt đầu mới'} value={startTime} required disabled={busy || uncertain} onChange={value => shift(startDate, value)}/></label>}
        {!task && <><label>Ngày kết thúc mới<DatePicker label="Ngày kết thúc mới" value={endDate} min={startDate} required disabled={busy || uncertain} onChange={setEndDate}/></label>{!allDay && <label>Giờ kết thúc mới<TimePicker label="Giờ kết thúc mới" value={endTime} required disabled={busy || uncertain} onChange={setEndTime}/></label>}<p className="reschedule-help">Mặc định giữ thời lượng khi đổi ngày/giờ bắt đầu. Giờ Việt Nam (UTC+7).</p></>}
        <div className="reschedule-preview"><span>{scheduleLabel(current)}</span><span>↓</span><strong>{target ? scheduleLabel(target) : 'Vui lòng chọn thời gian hợp lệ'}</strong></div>
        <label>{task ? 'Lý do đổi hạn' : 'Lý do dời lịch'} <span className="reschedule-help">(không bắt buộc)</span><textarea className="form-input" rows={3} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Ví dụ: Chờ bổ sung hồ sơ…"/></label><small className="reschedule-help">{reason.length}/500 · Lý do chỉ lưu trong lịch sử của bạn.</small>
      </fieldset>{error && <p role="alert" className="reschedule-error">{error}</p>}<footer><button type="submit" className="btn btn-primary" disabled={busy || !target || !changed}>{busy ? 'Đang lưu/kiểm tra kết quả…' : uncertain ? 'Thử lại yêu cầu này' : label}</button></footer></form>}
  </dialog>, document.body);
}

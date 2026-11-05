import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { dateKey, eventDate, eventTime, formatDate, parseDate, toTimestamp } from '../calendar/dateUtils';
import './reminders.css';
import { requestWithTimeout } from '../../services/requestTimeout';

import { ReminderValue, noReminder, reminderAvailable, reminderCutoff, reminderBeyondLimit, nextReminderMinute } from './reminderUtils';
export { noReminder, reminderValue, sameReminder } from './reminderUtils';
export type { ReminderValue } from './reminderUtils';

export function ReminderFields({ eventId, value, onChange, anchor: savedAnchor, allDay, endsAt: savedEnd, recurrence = 'NONE', disabled = false, allowUnscheduled = false, heading = 'Thông báo', showExpiredWarning = true }: {
  eventId?: string; recurrence?: import("../calendar/types").Recurrence; value: ReminderValue; onChange: (value: ReminderValue) => void; anchor?: string | null; allDay: boolean; endsAt?: string | null; disabled?: boolean; allowUnscheduled?: boolean; heading?: string; showExpiredWarning?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const calendarPeriod = recurrence === 'DAILY' ? 86400000 : recurrence === 'WEEKLY' ? 7 * 86400000 : 0;
  const period = value.reminder_repeat ? calendarPeriod : 0;
  const offset = (value.reminder_minutes ?? 0) * 60000;
  const first = savedAnchor ? Date.parse(savedAnchor) : NaN;
  const firstStamp = period && value.reminder_at && savedAnchor ? Date.parse(toTimestamp(eventDate(savedAnchor), eventTime(value.reminder_at))) : first - offset;
  const occurrence = period && Number.isFinite(firstStamp) ? Math.max(0, Math.floor((now - firstStamp) / period) + 1) : 0;
  const anchor = period && Number.isFinite(first) ? new Date(first + occurrence * period).toISOString() : savedAnchor;
  const endsAt = period && anchor && savedAnchor && savedEnd ? new Date(Date.parse(anchor) + Date.parse(savedEnd) - Date.parse(savedAnchor)).toISOString() : savedEnd;
  const available = (!!anchor || !!endsAt || allowUnscheduled) && reminderAvailable(anchor, allDay, now, endsAt);
  const hasReminder = !!value.reminder_at || value.reminder_minutes != null;
  // An unavailable schedule prevents new reminders, but must never prevent
  // clearing a carried-over reminder that would otherwise block saving.
  const choiceLocked = disabled || (!available && !hasReminder);
  const locked = disabled || !available;
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    const cutoff = calendarPeriod ? null : reminderCutoff(anchor, allDay, endsAt);
    const boundaries = [...(cutoff !== null ? [cutoff] : []), ...(!allDay && anchor ? [0, 15, 30, 60, 1440].map(minutes => Date.parse(anchor) - minutes * 60000) : [])];
    const selected = value.reminder_at ? Date.parse(value.reminder_at) : anchor && value.reminder_minutes != null ? Date.parse(anchor) - value.reminder_minutes * 60000 : NaN;
    if (Number.isFinite(selected)) boundaries.push(selected);
    const future = boundaries.filter(stamp => stamp > now);
    if (!future.length) return;
    const next = Math.min(...future);
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(20, next - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [anchor, allDay, endsAt, now, value.reminder_at, value.reminder_minutes, calendarPeriod, period]);
  const customTime = (at: number) => {
    const cutoff = calendarPeriod ? null : reminderCutoff(anchor, allDay, endsAt);
    const elapsed = cutoff !== null && cutoff <= at;
    const preferred = !anchor || elapsed ? at + 30 * 60000
      : allDay ? Date.parse(toTimestamp(eventDate(anchor), '09:00')) : Date.parse(anchor) - 30 * 60000;
    return nextReminderMinute(preferred, at, cutoff, !!endsAt || allDay);
  };
  const customInitial = customTime(now);
  const mode = value.reminder_at ? 'custom' : value.reminder_minutes != null ? String(value.reminder_minutes) : 'none';
  const stamp = value.reminder_at ? period && Number.isFinite(firstStamp) ? new Date(firstStamp + occurrence * period).toISOString() : value.reminder_at : (anchor && value.reminder_minutes != null ? new Date(Date.parse(anchor) - value.reminder_minutes * 60000).toISOString() : undefined);
  const beyondLimit = !calendarPeriod && reminderBeyondLimit(stamp, anchor, allDay, endsAt, now);
  const limitMessage = beyondLimit ? `Thông báo ngày ${formatDate(eventDate(stamp!), { day: '2-digit', month: '2-digit', year: 'numeric' })} lúc ${eventTime(stamp!)} sẽ không được gửi vì ${endsAt ? 'không trước thời điểm kết thúc' : 'vượt quá hạn của công việc'}.` : '';
  const expired = stamp && Date.parse(stamp) <= now;
  const pastDay = !!stamp && dateKey(eventDate(stamp)) < dateKey(eventDate(new Date(now).toISOString()));
  const expiredMessage = expired && stamp ? pastDay
    ? `Thông báo ngày ${formatDate(eventDate(stamp), { day: '2-digit', month: '2-digit', year: 'numeric' })} sẽ không được gửi vì thời điểm này đã qua.`
    : `Thông báo lúc ${eventTime(stamp)} sẽ không được gửi vì thời điểm này đã qua.` : '';
  const serverKey = eventId && period && hasReminder ? `${eventId}/${value.reminder_minutes}/${value.reminder_at}/${savedAnchor}/${savedEnd}/${recurrence}/${now}` : '';
  const [next, setNext] = useState<{ key: string; at: string | null; error: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!serverKey) return;
    const controller = new AbortController();
    const params = new URLSearchParams(value.reminder_minutes != null ? { minutes: String(value.reminder_minutes) } : { at: value.reminder_at! });
    requestWithTimeout<{ at: string | null }>(`/api/calendar/events/${encodeURIComponent(eventId!)}/next-reminder?${params}`, { signal: controller.signal, cache: 'no-store' })
      .then(result => { if (!controller.signal.aborted) setNext({ key: serverKey, at: result.at, error: '' }); })
      .catch(reason => { if (!controller.signal.aborted) setNext({ key: serverKey, at: null, error: reason instanceof Error ? reason.message : 'Không tính được thông báo tiếp theo.' }); });
    return () => controller.abort();
  }, [serverKey, retry, eventId, value.reminder_minutes, value.reminder_at]);
  const displayStamp = serverKey ? next?.key === serverKey ? next.at : undefined : stamp;
  const label = displayStamp && new Date(displayStamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return <section className={`reminder-fields${!available ? ' is-unavailable' : ''}`} aria-label={heading}>
    <label className={`reminder-choice${choiceLocked ? ' is-locked' : ''}`}><span><Bell size={14} />{heading}</span><select className="form-input" aria-label="Thời gian thông báo" value={mode} disabled={choiceLocked} onChange={event => {
      const selected = event.target.value;
      if (selected === 'none') onChange({ ...noReminder(), ...(value.reminder_repeat !== undefined ? { reminder_repeat: value.reminder_repeat } : {}) });
      else if (!available) return;
      else if (selected === 'custom') {
        const stamp = customTime(Date.now());
        if (stamp === null) { setNow(Date.now()); return; }
        const initial = new Date(stamp).toISOString();
        onChange({ ...value, reminder_minutes: null, reminder_at: initial });
      } else onChange({ ...value, reminder_minutes: Number(selected), reminder_at: null });
    }}>
      <option value="none">Không nhắc</option>
      {[['0', 'Đúng giờ'], ['15', 'Trước 15 phút'], ['30', 'Trước 30 phút'], ['60', 'Trước 1 giờ'], ['1440', 'Trước 1 ngày']].map(([key, text]) => <option key={key} value={key} disabled={!available || allDay || !anchor || (!period && Date.parse(anchor) - Number(key) * 60000 <= now)}>{text}</option>)}
      <option value="custom" disabled={!available || customInitial === null}>{period ? 'Chọn giờ…' : 'Chọn ngày và giờ…'}</option>
    </select></label>
    {!!calendarPeriod && <label className="reminder-repeat"><input type="checkbox" checked={!!value.reminder_repeat} disabled={locked} onChange={event => onChange({ ...value, reminder_repeat: event.target.checked })} />Thông báo lặp lại {recurrence === 'DAILY' ? 'hằng ngày' : 'hằng tuần'}</label>}
    {value.reminder_at && <div className={`reminder-custom${period ? ' is-repeating' : ''}`}>{!period && <div><span>Ngày thông báo</span><DatePicker validationMessage={limitMessage} label="Ngày thông báo" required disabled={locked} value={dateKey(eventDate(value.reminder_at))} onChange={day => { if (day) onChange({ ...value, reminder_minutes: null, reminder_at: toTimestamp(parseDate(day), eventTime(value.reminder_at!)) }); }} /></div>}
      <div><span>Giờ thông báo</span><TimePicker label="Giờ thông báo" required disabled={locked} value={eventTime(value.reminder_at)} onChange={time => { if (time) onChange({ ...value, reminder_minutes: null, reminder_at: toTimestamp(eventDate(value.reminder_at!), time) }); }} /></div></div>}
    {!available && hasReminder ? <p className="reminder-warning" role="alert">Ngày giờ bắt đầu hoặc kết thúc chưa hợp lệ. Hãy kiểm tra lại lịch. Chọn <strong>Không nhắc</strong> để bỏ thông báo này, hoặc chỉnh lại lịch để đặt thông báo mới.</p>
      : beyondLimit ? <p className="reminder-warning" role="alert"><strong>{limitMessage}</strong><br />Chọn ngày hoặc giờ thông báo khác hoặc chọn Không nhắc.</p> : !anchor && !allowUnscheduled ? <p>Chọn ngày bắt đầu và giờ để đặt thông báo trước giờ bắt đầu.</p> : !available ? <p>Ngày giờ bắt đầu hoặc kết thúc chưa hợp lệ. Hãy kiểm tra lại lịch.</p> : allDay && value.reminder_minutes != null ? <p className="reminder-warning">{'V\u1edbi m\u1ee5c c\u1ea3 ng\u00e0y, h\u00e3y ch\u1ecdn gi\u1edd th\u00f4ng b\u00e1o c\u1ee5 th\u1ec3.'}</p>
      : stamp ? expired ? showExpiredWarning ? <p className="reminder-warning"><strong>{expiredMessage}</strong><br />Chọn {pastDay ? 'ngày' : 'giờ'} thông báo khác hoặc chọn Không nhắc.</p> : null
        : serverKey && next?.key !== serverKey ? <p role="status">Đang tính thông báo tiếp theo…</p> : serverKey && next?.error ? <p className="reminder-warning" role="alert">{next.error} <button type="button" className="btn btn-outline btn-sm" onClick={() => setRetry(value => value + 1)}>Thử lại</button></p> : serverKey && !displayStamp ? <p>Hiện không có thông báo tiếp theo.</p> : <p>{period ? 'Thông báo tiếp theo: ' : 'Thông báo lúc '}{label} (giờ Việt Nam).{period ? recurrence === 'DAILY' ? ' Lặp hằng ngày theo lịch.' : ' Lặp hằng tuần theo lịch.' : calendarPeriod || allDay ? ' Chỉ gửi một lần.' : ''}</p>
        : customInitial === null ? <p>Không còn thời điểm hợp lệ trước hạn hoặc giờ kết thúc. Chọn Không nhắc hoặc điều chỉnh lịch để có thời điểm thông báo phù hợp.</p>
        : <p>Chọn thời điểm để nhận thông báo.</p>}
  </section>;
}

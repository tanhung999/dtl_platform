import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { dateKey, eventDate, eventTime, formatDate, parseDate, toTimestamp } from '../calendar/dateUtils';
import './reminders.css';

import { ReminderValue, noReminder, reminderAvailable, reminderCutoff, reminderBeyondLimit } from './reminderUtils';
export { noReminder, reminderValue, sameReminder } from './reminderUtils';
export type { ReminderValue } from './reminderUtils';

export function ReminderFields({ value, onChange, anchor, allDay, endsAt, disabled = false }: {
  value: ReminderValue; onChange: (value: ReminderValue) => void; anchor?: string | null; allDay: boolean; endsAt?: string | null; disabled?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const available = reminderAvailable(anchor, allDay, now, endsAt);
  const locked = disabled || !available;
  useEffect(() => {
    const update = () => setNow(Date.now());
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => { window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, []);
  useEffect(() => {
    const cutoff = reminderCutoff(anchor, allDay, endsAt);
    if (cutoff === null || cutoff <= now) return;
    const boundaries = [cutoff, ...(!allDay && anchor ? [0, 15, 30, 60, 1440].map(minutes => Date.parse(anchor) - minutes * 60000) : [])];
    const selected = value.reminder_at ? Date.parse(value.reminder_at) : anchor && value.reminder_minutes != null ? Date.parse(anchor) - value.reminder_minutes * 60000 : NaN;
    if (Number.isFinite(selected)) boundaries.push(selected);
    const next = Math.min(...boundaries.filter(stamp => stamp > now));
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(20, next - Date.now() + 1)));
    return () => clearTimeout(timer);
  }, [anchor, allDay, endsAt, now, value.reminder_at, value.reminder_minutes]);
  const mode = value.reminder_at ? 'custom' : value.reminder_minutes != null ? String(value.reminder_minutes) : 'none';
  const stamp = value.reminder_at || (anchor && value.reminder_minutes != null ? new Date(Date.parse(anchor) - value.reminder_minutes * 60000).toISOString() : undefined);
  const beyondLimit = reminderBeyondLimit(stamp, anchor, allDay, endsAt);
  const limitMessage = beyondLimit ? `Nhắc hạn ngày ${formatDate(eventDate(stamp!), { day: '2-digit', month: '2-digit', year: 'numeric' })} lúc ${eventTime(stamp!)} sẽ không được gửi vì ${endsAt ? 'không trước thời điểm kết thúc' : 'vượt quá hạn của công việc'}.` : '';
  const expired = stamp && Date.parse(stamp) <= now;
  const pastDay = !!stamp && dateKey(eventDate(stamp)) < dateKey(eventDate(new Date(now).toISOString()));
  const expiredMessage = expired && stamp ? pastDay
    ? `Nhắc hạn ngày ${formatDate(eventDate(stamp), { day: '2-digit', month: '2-digit', year: 'numeric' })} sẽ không được gửi vì thời điểm này đã qua.`
    : `Nhắc lúc ${eventTime(stamp)} giờ sẽ không được gửi vì thời điểm này đã qua.` : '';
  const label = stamp && new Date(stamp).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return <section className={`reminder-fields${!available ? ' is-unavailable' : ''}`} aria-label="Nhắc nhở">
    <label className="reminder-choice"><span><Bell size={14} />Nhắc nhở</span><select className="form-input" aria-label="Thời gian nhắc nhở" value={mode} disabled={locked} onChange={event => {
      const selected = event.target.value;
      if (selected === 'none') onChange(noReminder());
      else if (selected === 'custom') {
        const preferred = allDay ? Date.parse(toTimestamp(eventDate(anchor!), '09:00')) : Date.parse(anchor!) - 30 * 60000;
        const nextMinute = Math.ceil((Date.now() + 1) / 60000) * 60000;
        const latest = reminderCutoff(anchor, allDay, endsAt)! - (allDay || endsAt ? 60000 : 0);
        const initial = new Date(Math.min(latest, Math.max(preferred, nextMinute))).toISOString();
        onChange({ reminder_minutes: null, reminder_at: initial });
      } else onChange({ reminder_minutes: Number(selected), reminder_at: null });
    }}>
      <option value="none">Không nhắc</option>
      {[['0', 'Đúng giờ'], ['15', 'Trước 15 phút'], ['30', 'Trước 30 phút'], ['60', 'Trước 1 giờ'], ['1440', 'Trước 1 ngày']].map(([key, text]) => <option key={key} value={key} disabled={allDay || !anchor || Date.parse(anchor) - Number(key) * 60000 <= now}>{text}</option>)}
      <option value="custom">Chọn ngày và giờ…</option>
    </select></label>
    {value.reminder_at && <div className="reminder-custom"><div><span>Ngày nhắc hạn</span><DatePicker validationMessage={limitMessage} label="Ngày nhắc hạn" required disabled={locked} value={dateKey(eventDate(value.reminder_at))} onChange={day => { if (day) onChange({ reminder_minutes: null, reminder_at: toTimestamp(parseDate(day), eventTime(value.reminder_at!)) }); }} /></div>
      <div><span>Giờ nhắc hạn</span><TimePicker label="Giờ nhắc hạn" required disabled={locked} value={eventTime(value.reminder_at)} onChange={time => { if (time) onChange({ reminder_minutes: null, reminder_at: toTimestamp(eventDate(value.reminder_at!), time) }); }} /></div></div>}
    {beyondLimit ? <p className="reminder-warning" role="alert"><strong>{limitMessage}</strong><br />Chọn ngày hoặc giờ nhắc khác hoặc chọn Không nhắc.</p> : !anchor ? <p>Chọn ngày giờ để bật nhắc hạn.</p> : !available ? <p>Ngày giờ đã qua hoặc chưa hợp lệ.</p> : allDay && value.reminder_minutes != null ? <p className="reminder-warning">Mục cả ngày cần chọn ngày và giờ nhắc hạn cụ thể.</p>
      : stamp ? expired ? <p className="reminder-warning"><strong>{expiredMessage}</strong><br />Chọn {pastDay ? 'ngày' : 'giờ'} nhắc khác hoặc chọn Không nhắc.</p>
        : <p>Thông báo lúc {label} (giờ Việt Nam).</p>
        : <p>Chỉ gửi thông báo khi bạn chọn thời gian nhắc.</p>}
  </section>;
}

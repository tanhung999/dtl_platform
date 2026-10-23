import { changeNoteScheduleStart } from './scheduleUtils';
import { RecurrenceSelect } from '../calendar/components/RecurrenceSelect';
import type { ReactNode } from 'react';
import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';
import { NoteSchedule } from './types';
import './note-scheduling.css';
import { ReminderFields } from '../reminders/ReminderFields';

export function initialNoteSchedule(): NoteSchedule {
  const day = eventDate(new Date().toISOString());
  return { starts_at: toTimestamp(day, '09:00'), ends_at: toTimestamp(day, '10:00'), is_all_day: false };
}
export function NoteScheduleFields({ value, onChange, scheduleReadOnly = false, scheduleAction, showNotifications = true }: { showNotifications?: boolean; value: NoteSchedule; scheduleReadOnly?: boolean; scheduleAction?: ReactNode; onChange: (value: NoteSchedule) => void }) {
  const startDay = dateKey(eventDate(value.starts_at));
  const endDay = dateKey(eventDate(new Date(Date.parse(value.ends_at) - (value.is_all_day ? 1 : 0)).toISOString()));
  const changeStart = (day: string, time: string) => {
    if (!day) return;
    if (!time) { onChange(changeNoteScheduleStart(value, day, '')); return; }
    const starts = toTimestamp(parseDate(day), time);
    const end = toTimestamp(parseDate(day), eventTime(value.ends_at));
    onChange({ ...value, starts_at: starts, ends_at: end, is_all_day: false });
  };
  return <section className="note-schedule-fields" aria-label="Ngày giờ của ghi chú">
    <label className="calendar-checkbox note-all-day-toggle"><input type="checkbox" checked={value.is_all_day} disabled={scheduleReadOnly} onChange={event => {
      if (event.target.checked) onChange(changeNoteScheduleStart(value, startDay, ''));
      else onChange({ ...value, is_all_day: false, starts_at: toTimestamp(parseDate(startDay), '09:00'), ends_at: toTimestamp(parseDate(startDay), '10:00') });
    }} />Ghi chú cả ngày</label>
    <div className={!value.is_all_day ? 'note-schedule-start-day' : undefined}><span>Ngày bắt đầu</span><DatePicker disabled={scheduleReadOnly} label="Ngày bắt đầu" required value={startDay} onChange={day => changeStart(day, value.is_all_day ? '' : eventTime(value.starts_at))} /></div>
    {!value.is_all_day && <div><span>Giờ bắt đầu</span><TimePicker disabled={scheduleReadOnly} label="Giờ bắt đầu" required value={eventTime(value.starts_at)} onChange={time => { if (time) changeStart(startDay, time); }} /></div>}
    {value.is_all_day && <div><span>Ngày kết thúc</span><DatePicker disabled={scheduleReadOnly} label="Ngày kết thúc" required min={startDay} value={endDay} align="end" onChange={day => { if (day) onChange({ ...value, ends_at: toTimestamp(addDays(parseDate(day), 1)) }); }}/></div>}
    {!value.is_all_day && <div><span>Giờ kết thúc</span><TimePicker disabled={scheduleReadOnly} label="Giờ kết thúc" required value={eventTime(value.ends_at)} onChange={time => { if (time) onChange({ ...value, ends_at: toTimestamp(parseDate(startDay), time) }); }} /></div>}
    <RecurrenceSelect startDate={startDay} value={value.recurrence ?? 'NONE'} disabled={scheduleReadOnly} onChange={recurrence => onChange({ ...value, recurrence, ends_at: value.is_all_day ? value.ends_at : toTimestamp(parseDate(startDay), eventTime(value.ends_at)) })}/>
    {value.recurrence && value.recurrence !== 'NONE' && <p>Lặp không thời hạn. Khi dời hoặc xóa, bạn có thể chọn phần lịch cần áp dụng.</p>}
    {scheduleReadOnly && scheduleAction && <p>Chọn “Dời lịch / Thông báo” để thay đổi lịch hoặc cài đặt thông báo.</p>}
    {scheduleAction && <div className="note-schedule-action">{scheduleAction}</div>}
    {showNotifications && <ReminderFields eventId={value.event_id} recurrence={value.recurrence} value={value} onChange={reminder => onChange({ ...value, ...reminder })} anchor={value.starts_at} endsAt={value.ends_at} allDay={value.is_all_day} />}
  </section>;
}

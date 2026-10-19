import { DatePicker } from '../../components/date-time/DatePicker';
import { TimePicker } from '../../components/date-time/TimePicker';
import { addDays, dateKey, eventDate, eventTime, parseDate, toTimestamp } from '../calendar/dateUtils';
import { NoteSchedule } from './types';
import './note-scheduling.css';

export function initialNoteSchedule(): NoteSchedule {
  const day = eventDate(new Date().toISOString());
  return { starts_at: toTimestamp(day), ends_at: toTimestamp(addDays(day, 1)), is_all_day: true };
}
export function NoteScheduleFields({ value, onChange }: { value: NoteSchedule; onChange: (value: NoteSchedule) => void }) {
  const startDay = dateKey(eventDate(value.starts_at));
  const endDay = dateKey(eventDate(value.is_all_day ? new Date(Date.parse(value.ends_at) - 1).toISOString() : value.ends_at));
  const changeStart = (day: string, time: string) => {
    if (!day) return;
    const start = toTimestamp(parseDate(day), time || '00:00');
    const duration = value.is_all_day ? 30 * 60000 : Date.parse(value.ends_at) - Date.parse(value.starts_at);
    onChange({ ...value, starts_at: start, ends_at: time ? new Date(Date.parse(start) + duration).toISOString() : toTimestamp(addDays(parseDate(day), 1)), is_all_day: !time });
  };
  return <section className="note-schedule-fields" aria-label="Ngày giờ của ghi chú">
    <div><span>Ngày bắt đầu</span><DatePicker label="Ngày lịch hẹn" required value={startDay} onChange={day => changeStart(day, value.is_all_day ? '' : eventTime(value.starts_at))} /></div>
    <div><span>Giờ (tùy chọn)</span><TimePicker label="Giờ lịch hẹn" value={value.is_all_day ? '' : eventTime(value.starts_at)} onChange={time => changeStart(startDay, time)} /></div>
    <div><span>Ngày kết thúc</span><DatePicker label="Ngày kết thúc lịch hẹn" required min={startDay} value={endDay} align="end" onChange={day => { if (day) onChange({ ...value, ends_at: value.is_all_day ? toTimestamp(addDays(parseDate(day), 1)) : toTimestamp(parseDate(day), eventTime(value.ends_at)) }); }} /></div>
    {!value.is_all_day && <div><span>Giờ kết thúc</span><TimePicker label="Giờ kết thúc lịch hẹn" required value={eventTime(value.ends_at)} onChange={time => { if (time) onChange({ ...value, ends_at: toTimestamp(parseDate(endDay), time) }); }} /></div>}
    <p>{value.is_all_day ? 'Chỉ chọn ngày: ghi chú hiện ở vùng Cả ngày.' : 'Ghi chú hiện trên lưới giờ. Giờ Việt Nam (UTC+7).'}</p>
    {endDay !== startDay && <p className="note-schedule-range-hint" role="status">Ghi chú kéo dài liên tục qua nhiều ngày, không lặp lại cùng giờ mỗi ngày. Chọn cùng ngày bắt đầu và kết thúc nếu chỉ cần một buổi.</p>}
    <p>Lịch hẹn và liên kết được lưu khi bấm Lưu ghi chú. Nội dung ghi chú vẫn ở Notes.</p>
  </section>;
}

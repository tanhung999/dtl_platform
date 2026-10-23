import type { Recurrence } from '../types';
import { parseDate } from '../dateUtils';

const weekdays = ['chủ nhật', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy'];
export function RecurrenceSelect({ value, onChange, startDate, disabled = false }: {
  value: Recurrence; onChange: (value: Recurrence) => void; startDate: string; disabled?: boolean;
}) {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? parseDate(startDate).getUTCDay() : undefined;
  return <label className="calendar-field">Lặp lại<select className="form-input calendar-recurrence-select" aria-label="Lặp lại" value={value} disabled={disabled} onChange={event => onChange(event.target.value as Recurrence)}><option value="NONE">Không lặp lại</option><option value="DAILY">Hằng ngày</option><option value="WEEKLY">{day === undefined ? 'Hằng tuần' : `Hằng tuần vào ${weekdays[day]}`}</option></select></label>;
}

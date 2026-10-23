import { useId } from 'react';
import { dateKey, eventDate, parseDate, today } from '../dateUtils';
import type { Recurrence } from '../types';
import './recurrence-scope.css';

export type RecurrenceScope = 'ALL' | 'FOLLOWING' | 'THIS';
export interface ScopeSelection { scope: RecurrenceScope; occurrence_at: string }
export function occurrenceFor(starts: string, recurrence?: Recurrence, selected?: string) {
  if (selected) return selected;
  const first = eventDate(starts), day = today();
  const period = recurrence === 'WEEKLY' ? 7 : 1;
  const delta = Math.max(0, Math.ceil((day.getTime() - first.getTime()) / 86400000 / period));
  return new Date(Date.parse(starts) + delta * period * 86400000).toISOString();
}
export function RecurrenceScopePicker({ value, onChange, at, action, disabled = false }: { value: RecurrenceScope; onChange: (scope: RecurrenceScope) => void; at: string; action: 'delete' | 'move'; disabled?: boolean }) {
  const name = useId();
  const day = parseDate(dateKey(eventDate(at))).toLocaleDateString('vi-VN', {day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
  return <fieldset className="recurrence-scope" disabled={disabled}>
    <legend>{action === 'delete' ? 'Bạn muốn xóa phần nào?' : 'Bạn muốn dời phần nào?'}</legend>
    <p className="recurrence-scope-date">Lần đang chọn: <strong>{day}</strong></p>
    {([
      ['ALL', 'Cả chuỗi', 'Áp dụng cho tất cả các lần, kể cả trước ngày đang chọn.'],
      ['FOLLOWING', 'Lần này và các lần sau', `Áp dụng từ ${day}; các lần trước giữ nguyên.`],
      ['THIS', 'Chỉ lần này', `Chỉ áp dụng ngày ${day}; các lần khác giữ nguyên.`],
    ] as const).map(([scope, title, detail]) => <label key={scope} className={value === scope ? 'is-selected' : ''}><input type="radio" name={name} value={scope} checked={value === scope} onChange={() => onChange(scope)} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}
  </fieldset>;
}

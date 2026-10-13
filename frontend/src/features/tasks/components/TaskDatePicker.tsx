import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { displayTaskDate, parseTaskDate } from '../dateInputUtils';
import { vietnamDay } from '../deadlineUtils';
import './TaskDatePicker.css';

interface Props { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; }

export function TaskDatePicker({ value, onChange, label, disabled = false }: Props) {
  const [text, setText] = useState(() => displayTaskDate(value));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || vietnamDay()).slice(0, 7));
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setText(displayTaskDate(value)); input.current?.setCustomValidity(''); }, [value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const first = new Date(`${month}-01T00:00:00Z`);
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * 86400000;
  const days = Array.from({ length: 42 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10));
  const move = (offset: number) => {
    const next = new Date(first); next.setUTCMonth(next.getUTCMonth() + offset);
    setMonth(next.toISOString().slice(0, 7));
  };
  const choose = (date: string) => { onChange(date); setText(displayTaskDate(date)); input.current?.setCustomValidity(''); setOpen(false); trigger.current?.focus(); };
  return <div className="task-date-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="task-date-input" onClick={() => { if (!disabled && !open) { setMonth((value || vietnamDay()).slice(0, 7)); setOpen(true); } }}><input ref={input} type="text" inputMode="numeric" placeholder="dd/mm/yyyy" aria-label={label} aria-expanded={open} disabled={disabled} value={text} maxLength={10} autoComplete="off" onKeyDown={event => { if (event.key === 'ArrowDown' && !disabled) { event.preventDefault(); setMonth((value || vietnamDay()).slice(0, 7)); setOpen(true); } }} onChange={event => {
      const raw = event.target.value; setText(raw);
      const parsed = parseTaskDate(raw);
      event.target.setCustomValidity(parsed === null ? 'Nhập ngày hợp lệ theo định dạng dd/mm/yyyy.' : '');
      if (parsed !== null) onChange(parsed);
    }} /><button ref={trigger} type="button" disabled={disabled} aria-label={`Chọn ${label.toLowerCase()}`} aria-expanded={open} onClick={event => { event.stopPropagation(); setMonth((value || vietnamDay()).slice(0, 7)); setOpen(!open); }}><CalendarDays size={16} /></button></div>
    {open && <div className="task-date-popover" role="group" aria-label="Chọn ngày hạn">
      <div className="task-date-heading"><button type="button" aria-label="Tháng trước" onClick={() => move(-1)}><ChevronLeft size={16} /></button><strong>Tháng {first.getUTCMonth() + 1}, {first.getUTCFullYear()}</strong><button type="button" aria-label="Tháng sau" onClick={() => move(1)}><ChevronRight size={16} /></button></div>
      <div className="task-date-grid">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => <span key={day}>{day}</span>)}{days.map(day => <button key={day} type="button" aria-label={`Chọn ngày ${displayTaskDate(day)}`} aria-pressed={day === value} className={`${day.slice(0, 7) !== month ? 'outside-month' : ''} ${day === vietnamDay() ? 'is-today' : ''}`} onClick={() => choose(day)}>{Number(day.slice(8))}</button>)}</div>
      <div className="task-date-footer"><button type="button" onClick={() => choose(vietnamDay())}>Hôm nay</button><button type="button" onClick={() => choose('')}>Xóa hạn</button></div>
    </div>}
  </div>;
}

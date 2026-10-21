import { useEffect, useId, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { displayDateInput, parseDateInput, vietnamDate } from './dateInputUtils';
import './DatePicker.css';
import { usePickerPopover } from './usePickerPopover';

interface Props { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; required?: boolean; min?: string; align?: 'start' | 'end'; clearLabel?: string; validationMessage?: string; }

export function DatePicker({ value, onChange, label, disabled = false, required = false, min, align = 'start', clearLabel = 'Xóa ngày', validationMessage = '' }: Props) {
  const [text, setText] = useState(() => displayDateInput(value));
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || vietnamDate()).slice(0, 7));
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const panel = useRef<HTMLDivElement>(null);
  usePickerPopover(open, root, panel, align);
  const allowed = (date: string) => !min || date >= min;
  const validate = (raw: string) => {
    const parsed = parseDateInput(raw);
    return parsed === null ? 'Nhập ngày hợp lệ theo định dạng dd/mm/yyyy.' : parsed && !allowed(parsed) ? `${label} không được trước ${displayDateInput(min!)}.` : validationMessage;
  };
  useEffect(() => { setText(displayDateInput(value)); }, [value]);
  useEffect(() => { input.current?.setCustomValidity(validate(text)); }, [text, min, label, validationMessage]);
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
  const choose = (date: string) => { if (date && !allowed(date)) return; onChange(date); setText(displayDateInput(date)); input.current?.setCustomValidity(validate(displayDateInput(date))); setOpen(false); trigger.current?.focus(); };
  return <div className="app-date-picker" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <div className="app-date-input" onClick={() => { if (!disabled && !open) { setMonth((value || vietnamDate()).slice(0, 7)); setOpen(true); } }}><input ref={input} type="text" inputMode="numeric" placeholder="dd/mm/yyyy" aria-label={label} aria-expanded={open} aria-controls={panelId} required={required} disabled={disabled} value={text} maxLength={10} autoComplete="off" onKeyDown={event => { if (event.key === 'ArrowDown' && !disabled) { event.preventDefault(); setMonth((value || vietnamDate()).slice(0, 7)); setOpen(true); } }} onChange={event => {
      const raw = event.target.value; setText(raw);
      const parsed = parseDateInput(raw);
      event.target.setCustomValidity(validate(raw));
      if (parsed !== null && (!parsed || allowed(parsed))) onChange(parsed);
    }} /><button ref={trigger} type="button" disabled={disabled} aria-label={`Chọn ${label.toLowerCase()}`} aria-expanded={open} aria-controls={panelId} onClick={event => { event.stopPropagation(); setMonth((value || vietnamDate()).slice(0, 7)); setOpen(!open); }}><CalendarDays size={16} /></button></div>
    {open && <div ref={panel} id={panelId} className="app-date-popover" role="group" aria-label={`Chọn ${label.toLowerCase()}`}>
      <div className="app-date-heading"><button type="button" aria-label="Tháng trước" onClick={() => move(-1)}><ChevronLeft size={16} /></button><strong>Tháng {first.getUTCMonth() + 1}, {first.getUTCFullYear()}</strong><button type="button" aria-label="Tháng sau" onClick={() => move(1)}><ChevronRight size={16} /></button></div>
      <div className="app-date-grid">{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map(day => <span key={day}>{day}</span>)}{days.map(day => <button key={day} type="button" aria-label={`Chọn ngày ${displayDateInput(day)}`} aria-pressed={day === value} disabled={!allowed(day)} className={`${day.slice(0, 7) !== month ? 'outside-month' : ''} ${day === vietnamDate() ? 'is-today' : ''}`} onClick={() => choose(day)}>{Number(day.slice(8))}</button>)}</div>
      <div className="app-date-footer"><button type="button" disabled={!allowed(vietnamDate())} onClick={() => choose(vietnamDate())}>Hôm nay</button>{!required && <button type="button" onClick={() => choose('')}>{clearLabel}</button>}</div>
    </div>}
  </div>;
}

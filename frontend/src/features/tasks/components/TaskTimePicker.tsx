import { useEffect, useId, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import './TaskTimePicker.css';

interface Props { value: string; onChange: (value: string) => void; label: string; disabled?: boolean; }

export function TaskTimePicker({ value, onChange, label, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [hour, minute] = (value || '09:00').split(':');
  useEffect(() => { setText(value); input.current?.setCustomValidity(''); }, [value]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (time: string) => { setText(time); input.current?.setCustomValidity(''); onChange(time); };
  return <div ref={root} className="task-time-picker" onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(); }
  }}>
    <div className="task-time-input" onClick={() => { if (!disabled) setOpen(true); }}>
      <input ref={input} type="text" inputMode="numeric" placeholder="HH:mm" maxLength={5} autoComplete="off" aria-label={label} aria-expanded={open} aria-controls={panelId} disabled={disabled} value={text} onChange={event => {
        const raw = event.target.value;
        setText(raw);
        const valid = !raw || /^([01]\d|2[0-3]):[0-5]\d$/.test(raw);
        event.target.setCustomValidity(valid ? '' : 'Nhập giờ theo định dạng 24 giờ HH:mm, ví dụ 14:00.');
        if (valid) onChange(raw);
      }} onKeyDown={event => { if (event.key === 'ArrowDown' && !disabled) { event.preventDefault(); setOpen(true); } }} />
      {value && <span className="task-time-period">{Number(value.slice(0, 2)) < 12 ? 'AM' : 'PM'}</span>}
      <button ref={trigger} type="button" aria-label={`Chọn ${label.toLowerCase()}`} aria-expanded={open} aria-controls={panelId} disabled={disabled} onClick={event => { event.stopPropagation(); setOpen(value => !value); }}><Clock3 size={16} /></button>
    </div>
    {open && <div id={panelId} className="task-time-popover" role="group" aria-label="Chọn giờ hạn">
      <div className="task-time-columns">
        <label>Giờ<select aria-label="Chọn giờ" size={6} value={hour} onChange={event => choose(`${event.target.value}:${minute}`)}>{Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(hour => <option key={hour} value={hour}>{hour}</option>)}</select></label>
        <label>Phút<select aria-label="Chọn phút" size={6} value={minute} onChange={event => choose(`${hour}:${event.target.value}`)}>{Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')).map(minute => <option key={minute} value={minute}>{minute}</option>)}</select></label>
      </div>
      <div className="task-time-footer"><button type="button" onClick={() => { choose(''); close(); }}>Xóa giờ</button><button type="button" onClick={() => { choose(`${hour}:${minute}`); close(); }}>Xong</button></div>
    </div>}
  </div>;
}

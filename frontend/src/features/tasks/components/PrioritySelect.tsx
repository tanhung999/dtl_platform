import { PriorityIcon } from './PriorityIcon';
import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { TaskPriority } from '../../../types';
import { usePickerPopover } from '../../../components/date-time/usePickerPopover';
import { normalizedPriority, PRIORITY_LABELS, PRIORITY_OPTIONS } from '../deadlineUtils';
import '../priority.css';
import './priority-select.css';

export function PrioritySelect({ value, onChange, label, disabled = false }: {
  value: TaskPriority; onChange: (value: TaskPriority) => void; label: string; disabled?: boolean;
}) {
  const selected = normalizedPriority(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(selected);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  usePickerPopover(open, root, panel);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  const choose = (priority: TaskPriority) => { onChange(priority); setOpen(false); trigger.current?.focus(); };
  return <div ref={root} className="task-priority-picker" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    if (event.key === 'Tab') setOpen(false);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = PRIORITY_OPTIONS.indexOf(open ? active : selected);
      setActive(event.key === 'Home' ? 'URGENT' : event.key === 'End' ? 'LOW' : PRIORITY_OPTIONS[(index + (event.key === 'ArrowUp' ? -1 : 1) + PRIORITY_OPTIONS.length) % PRIORITY_OPTIONS.length]);
      setOpen(true);
    }
    if (open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(active); }
  }}>
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
      className={`task-priority-select priority-${selected}`} disabled={disabled} onClick={() => { setActive(selected); setOpen(!open); }}>
      <PriorityIcon priority={selected} decorative /><span>{PRIORITY_LABELS[selected]}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && <div ref={panel} id={id} role="listbox" aria-label={label} className="task-priority-menu">
      {PRIORITY_OPTIONS.map(priority => <div key={priority} id={`${id}-${priority}`} role="option" aria-selected={selected === priority}
        className={`task-priority-option priority-${priority} ${active === priority ? 'is-active' : ''}`}
        onPointerDown={event => event.preventDefault()} onPointerMove={() => setActive(priority)} onClick={() => choose(priority)}>
        <PriorityIcon priority={priority} decorative /><span>{PRIORITY_LABELS[priority]}</span>{selected === priority && <Check className="task-priority-check" size={14} aria-hidden="true" />}
      </div>)}
    </div>}
  </div>;
}

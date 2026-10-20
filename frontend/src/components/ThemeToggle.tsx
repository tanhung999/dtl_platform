import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Gem, Heart, Leaf, Moon, Palette, Sparkles, Sun, Sunset, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { THEMES, themePreview } from '../theme/catalog';
import './theme-picker.css';

interface ThemeToggleProps { className?: string; showLabel?: boolean; }
const icons: Record<string, typeof Sun> = { sun: Sun, moon: Moon, sparkles: Sparkles, leaf: Leaf, sunset: Sunset, gem: Gem, heart: Heart };

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const selected = THEMES.find(item => item.id === theme)!;
  const Icon = icons[selected.icon] ?? Sun;
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const height = panel.current?.offsetHeight ?? 400;
      const width = panel.current?.offsetWidth ?? 392;
      setPosition({ top: Math.max(12, Math.min(rect.bottom + 12, window.innerHeight - height - 12)), right: Math.min(window.innerWidth - width - 12, Math.max(12, window.innerWidth - rect.right)) });
    };
    place();
    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.scrollIntoView({ block: 'nearest' });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);


  return <>
    <button ref={trigger} type="button" onClick={() => setOpen(true)}
      className={`theme-toggle-btn theme-picker-trigger ${className}`} title={`Giao diện: ${selected.name}`}
      aria-label="Chọn giao diện" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}>
      <Icon size={17} /><span className={showLabel ? '' : 'theme-trigger-label'}>Giao diện</span><ChevronDown size={12} />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-labelledby={`${id}-title`}
      className="theme-picker-panel" style={position}>
      <div className="theme-picker-heading"><span className="theme-picker-emblem"><Palette size={19} /></span>
        <div><h2 id={`${id}-title`}>Không gian của bạn</h2><p>Chọn giao diện phù hợp với bạn</p></div>
        <button type="button" className="theme-picker-close" aria-label="Đóng chọn giao diện" onClick={() => close(true)}><X size={17} /></button>
      </div>
      <div role="radiogroup" aria-label="Giao diện website" className="theme-picker-grid"
        onKeyDown={event => {
          const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 2, ArrowLeft: -1, ArrowUp: -2 };
          if (!(event.key in steps) && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          const index = THEMES.findIndex(item => item.id === theme);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? THEMES.length - 1 : (index + steps[event.key] + THEMES.length) % THEMES.length;
          setTheme(THEMES[next].id);
          panel.current?.querySelector<HTMLButtonElement>(`[data-choice="${THEMES[next].id}"]`)?.focus();
        }}>
        {THEMES.map(item => {
          const ChoiceIcon = icons[item.icon] ?? Sun;
          return <button key={item.id} type="button" role="radio" aria-checked={theme === item.id}
            tabIndex={theme === item.id ? 0 : -1} data-choice={item.id} className={`theme-choice ${theme === item.id ? 'is-selected' : ''}`}
            onClick={() => setTheme(item.id)}>
            <span className="theme-preview" style={themePreview(item.id)} aria-hidden="true">
              <span className="theme-preview-nav"><i /><i /><i /></span>
              <span className="theme-preview-columns"><span><i /><i /></span><span><i /><i /><i /></span><span><i /><i /></span></span>
              <span className="theme-choice-check">{theme === item.id && <Check size={12} strokeWidth={3} />}</span>
            </span>
            <span className="theme-choice-name"><ChoiceIcon size={14} />{item.name}</span>
            <span className="theme-choice-description">{item.description}</span>
            <span className="theme-choice-tag">{item.label}</span>
          </button>;
        })}
      </div>
      <p className="theme-picker-footnote">Tự động ghi nhớ trên trình duyệt này</p>
    </div>, document.body)}
  </>;
};

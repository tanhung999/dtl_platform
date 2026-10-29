import { useEffect, useId, useState } from 'react';
import { LoaderCircle, Search, User, Users, X } from 'lucide-react';
import type { UserBrief } from '../../types';
import { requestWithTimeout } from '../../services/requestTimeout';
import './user-picker.css';

interface Props {
  value: UserBrief[]; onChange: (users: UserBrief[]) => void;
  multiple?: boolean; endpoint?: string; disabled?: boolean; label?: string;
}

function initials(user: UserBrief) {
  return (user.full_name.trim() || user.username).split(/\s+/).slice(-2).map(word => word[0]).join('').toLocaleUpperCase('vi');
}

export function UserPicker({ value, onChange, multiple=false, endpoint='/api/colleagues', disabled=false, label='Người theo dõi' }: Props) {
  const id = useId();
  const [query, setQuery] = useState(''), [focused, setFocused] = useState(false);
  const [results, setResults] = useState<UserBrief[]>([]), [pending, setPending] = useState(false), [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const search = query.trim();
  const options = results.filter(user => !value.some(selected => selected.id === user.id));
  const expanded = focused && !disabled && search.length >= 2;
  const Icon = multiple ? Users : User;

  useEffect(() => {
    setResults([]); setError(''); setActive(0);
    if (disabled || search.length < 2) { setPending(false); return; }
    const controller = new AbortController();
    setPending(true);
    const timer = setTimeout(() => {
      requestWithTimeout<UserBrief[]>(`${endpoint}?${new URLSearchParams({ q: search })}`, { signal: controller.signal })
        .then(users => { if (!controller.signal.aborted) setResults(users); })
        .catch(() => { if (!controller.signal.aborted) setError('Chưa tải được danh sách. Hãy nhập lại để thử.'); })
        .finally(() => { if (!controller.signal.aborted) setPending(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, endpoint, disabled]);

  const add = (user: UserBrief) => {
    if (disabled) return;
    onChange(multiple ? [...value.filter(selected => selected.id !== user.id), user] : [user]);
    setQuery(''); setResults([]); setActive(0);
  };

  return <div className="people-picker" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
    <label className="people-picker-label" htmlFor={id}><Icon size={15} aria-hidden="true" />{label}{multiple && value.length > 0 && <span className="people-picker-count" aria-hidden="true">{value.length}</span>}</label>
    <div className={`people-picker-control${disabled ? ' is-disabled' : ''}`}>
      {!!value.length && <div className="people-picker-chips">{value.map(user => <span className="people-chip" key={user.id} title={`${user.full_name} · @${user.username}`}>
        <span className="people-avatar" aria-hidden="true">{initials(user)}</span><span className="people-chip-name">{user.full_name}</span>
        <button type="button" disabled={disabled} aria-label={`Xóa ${user.full_name}`} onClick={() => onChange(value.filter(selected => selected.id !== user.id))}><X size={13} aria-hidden="true" /></button>
      </span>)}</div>}
      <div className="people-picker-search"><Search size={15} aria-hidden="true" /><input id={id} aria-label={label} value={query} disabled={disabled} autoComplete="off"
        placeholder={multiple ? 'Tìm người theo dõi…' : value.length ? 'Tìm người để giao lại…' : 'Tìm người nhận việc…'}
        role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-results` : undefined}
        aria-activedescendant={expanded && options[active] ? `${id}-option-${active}` : undefined}
        onFocus={() => setFocused(true)} onChange={event => { setFocused(true); setQuery(event.target.value); setActive(0); }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); if (expanded && !pending && options[active]) add(options[active]); return; }
          if (!expanded) return;
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setFocused(false); }
          else if (options.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
        }} />{pending && expanded && <LoaderCircle size={15} className="people-picker-spinner" aria-hidden="true" />}</div>
    </div>
    {expanded && <div className="people-picker-results" id={`${id}-results`} role="listbox" aria-label={`Kết quả tìm ${label.toLocaleLowerCase('vi')}`} aria-busy={pending}>
      {pending ? <p role="status">Đang tìm người dùng…</p> : error ? <p role="alert">{error}</p> : !options.length ? <p>Không tìm thấy người dùng phù hợp.</p> : options.map((user, index) =>
        <button type="button" role="option" tabIndex={-1} id={`${id}-option-${index}`} aria-selected={active === index} key={user.id}
          onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => add(user)}>
          <span className="people-avatar" aria-hidden="true">{initials(user)}</span><span className="people-result-details"><strong>{user.full_name}</strong><small>@{user.username}{user.department ? ` · ${user.department}` : ''}</small></span>
        </button>)}
    </div>}
  </div>;
}

import { useEffect, useState } from 'react';
import { CalendarDays, CheckSquare, StickyNote } from 'lucide-react';
import { request } from '../../services/api';
import { User } from '../../types';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { useTasks } from '../tasks/context/TasksContext';
import { CalendarNoteModal } from '../note-scheduling/CalendarNoteModal';
import { EventModal } from '../calendar/components/EventModal';
import { CalendarEvent } from '../calendar/types';
import { calendarApi } from '../calendar/api';
import { eventDate } from '../calendar/dateUtils';
import { useLatestRequest } from '../../services/useLatestRequest';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import './search.css';

type Kind = 'apps' | 'tasks' | 'notes' | 'events';
interface Hit { id: string; title: string; preview?: string; due_date?: string; due_time?: string; is_completed?: boolean; is_pinned?: boolean; starts_at?: string; ends_at?: string; is_all_day?: boolean; location?: string; }
interface Results { groups: Record<Kind, { items: Hit[]; total: number }>; offset: number; limit: number; }
const labels: Record<Kind | 'all', string> = { all: 'Tất cả', apps: 'Ứng dụng', tasks: 'Công việc', notes: 'Ghi chú', events: 'Sự kiện' };
const kinds: Kind[] = ['apps', 'tasks', 'notes', 'events'];
const icons = { tasks: CheckSquare, notes: StickyNote, events: CalendarDays };
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const stamp = (value: string, allDay = false) => new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', ...(allDay ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }) }).format(new Date(value));
function meta(kind: Kind, hit: Hit) {
  if (kind === 'tasks') return `${hit.is_completed ? 'Đã xong' : 'Chưa xong'} · ${hit.due_date ? `Hạn ${dateLabel(hit.due_date)}${hit.due_time ? ` · ${hit.due_time.slice(0, 5)}` : ''}` : 'Chưa có hạn'}`;
  if (kind === 'notes') return hit.is_pinned ? 'Đã ghim' : '';
  if (kind === 'events' && hit.starts_at && hit.ends_at) {
    // All-day end is exclusive; display the final covered day.
    const end = hit.is_all_day ? new Date(Date.parse(hit.ends_at) - 1).toISOString() : hit.ends_at;
    return `${hit.is_all_day ? 'Cả ngày · ' : ''}${stamp(hit.starts_at, hit.is_all_day)} – ${stamp(end, hit.is_all_day)}${hit.location ? ` · ${hit.location}` : ''}`;
  }
  return '';
}
export function SearchPage({ query, user }: { query: string; user: User }) {
  const [kind, setKind] = useState<Kind | 'all'>('all'), [offset, setOffset] = useState(0);
  const [data, setData] = useState<Results>(), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [openError, setOpenError] = useState(''), [openingId, setOpeningId] = useState('');
  const [noteId, setNoteId] = useState<string>(), [event, setEvent] = useState<CalendarEvent>();
  const tasks = useTasks(), opening = useLatestRequest();
  useEffect(() => { setKind('all'); setOffset(0); }, [query]);
  useEffect(() => { opening.cancel(); setOpeningId(''); setOpenError(''); }, [query, kind, offset, opening.cancel]);
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.some(topic => ['tasks', 'notes', 'calendar'].includes(topic))) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, changed); window.addEventListener('focus', refresh); window.addEventListener('online', refresh);
    return () => { window.removeEventListener(WORKSPACE_CHANGED, changed); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setData(undefined); setError('');
    if (query.trim().length < 2) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), kind, offset: String(offset), limit: kind === 'all' ? '5' : '20' });
      request<Results>(`/api/search?${params}`, { signal: controller.signal, cache: 'no-store' })
        .then(value => { if (!controller.signal.aborted) { setData(value); if (value.offset !== offset) setOffset(value.offset); } })
        .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tìm kiếm.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind, offset, revision, user.id, user.allowed_apps]);
  const filter = (value: Kind | 'all') => { if (value === kind && !offset) return; setData(undefined); setLoading(query.trim().length >= 2); setKind(value); setOffset(0); };
  const paginate = (value: number) => { setData(undefined); setLoading(true); setOffset(value); };
  const open = async (type: Kind, hit: Hit) => {
    const controller = opening.start(); setOpenError(''); setOpeningId(`${type}:${hit.id}`);
    try {
      if (type === 'notes') setNoteId(hit.id);
      else if (type === 'tasks') await tasks.openTask(hit.id, controller.signal);
      else if (type === 'events') { const item = await calendarApi.get(hit.id, controller.signal); if (!controller.signal.aborted) setEvent(item); }
    } catch (reason) { if (!controller.signal.aborted) setOpenError(reason instanceof Error ? reason.message : 'Không mở được nội dung.'); }
    finally { if (!controller.signal.aborted) setOpeningId(''); }
  };
  const changedCalendar = () => window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: ['calendar', 'notifications'] }));
  const total = data && kinds.reduce((sum, key) => sum + data.groups[key].total, 0);
  return <section className="workspace-section-page workspace-search-page" aria-label="Kết quả tìm kiếm">
    <h1>Tìm kiếm</h1>
    <div className="search-filters" aria-label="Loại kết quả">{(['all', ...kinds] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => filter(value)}>{labels[value]}</button>)}</div>
    {query.trim().length < 2 ? <p role="status">Nhập ít nhất 2 ký tự để tìm kiếm.</p> : loading ? <p role="status">Đang tìm kiếm…</p> : error ? <p role="alert" className="alert-error">{error} <button type="button" className="btn btn-outline btn-sm" onClick={() => setRevision(value => value + 1)}>Thử lại</button></p> : data && total === 0 ? <p role="status">Không tìm thấy kết quả phù hợp.</p> : null}
    {openError && <p role="alert" className="alert-error">{openError}</p>}
    {!loading && data && kinds.filter(type => kind === 'all' || kind === type).map(type => {
      const group = data.groups[type];
      if (!group.total) return null;
      return <section className="search-result-group" key={type} aria-label={labels[type]}>
        <h2>{labels[type]} <span>({group.total})</span></h2>
        {type === 'apps' ? <AppLauncherWidget allowedApps={user.allowed_apps ?? ''} resultIds={group.items.map(hit => hit.id)} /> : <div className="search-result-list">{group.items.map(hit => {
          const Icon = icons[type];
          return <button type="button" className="search-result" key={hit.id} disabled={!!openingId} onClick={() => { void open(type, hit); }}>
            <Icon size={20} aria-hidden="true" /><span><strong>{hit.title || 'Ghi chú không có tiêu đề'}</strong>{hit.preview && <span className="search-preview">{hit.preview}</span>}<span className="search-meta">{meta(type, hit)}</span></span>
          </button>;
        })}</div>}
        {kind === 'all' && group.total > group.items.length && <button type="button" className="workspace-text-link" onClick={() => filter(type)}>Xem tất cả {labels[type].toLowerCase()} ({group.total})</button>}
        {kind !== 'all' && group.total > data.limit && <div className="search-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={!offset} onClick={() => paginate(Math.max(0, offset - data.limit))}>Trang trước</button><span>{group.items.length ? offset + 1 : 0}–{offset + group.items.length} / {group.total}</span><button type="button" className="btn btn-outline btn-sm" disabled={offset + data.limit >= group.total} onClick={() => paginate(offset + data.limit)}>Trang sau</button></div>}
      </section>;
    })}
    {noteId && <CalendarNoteModal key={noteId} noteId={noteId} onClose={() => setNoteId(undefined)} />}
    {event && <EventModal key={event.id} event={event} draft={{ date: eventDate(event.starts_at) }} onClose={() => setEvent(undefined)}
      onSave={async (payload, id) => { await calendarApi.update(id!, payload); changedCalendar(); }}
      onDelete={async (id, updatedAt) => { await calendarApi.remove(id, updatedAt); changedCalendar(); }} />}
  </section>;
}

import { AnimatedCount } from '../../components/AnimatedCount';
import { useLatestRequest } from '../../services/useLatestRequest';
import { ReactNode, useEffect, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { addDays, addMonths, dateKey, formatDate, monthDays, parseDate, startOfWeek, today, toTimestamp, viewRange } from './dateUtils';
import { CalendarEvent, CalendarView, EventDraft } from './types';
import { useCalendarEvents } from './hooks/useCalendarEvents';
import { MiniCalendar } from './components/MiniCalendar';
import { MonthView } from './components/MonthView';
import { WeekView } from './components/WeekView';
import { AgendaView } from './components/AgendaView';
import { CalendarItemModal } from './components/CalendarItemModal';
import { OverdueGroup } from './components/OverdueGroup';
import { useTaskRange } from '../tasks/useTaskRange';
import { useTasks } from '../tasks/context/TasksContext';
import { vietnamDay } from '../tasks/deadlineUtils';
import './calendar.css';
import { EventStatusLegend } from './components/EventStatusBadge';
import { calendarApi } from './api';
import { useCalendarDays } from './hooks/useCalendarDays';
import { FeatureIcon } from '../../components/FeatureIcon';

interface Props { initialDate?: Date; userName: string; userId: string; sharingControls?: ReactNode }

export function CalendarPage({ initialDate, userName, userId, sharingControls }: Props) {
  const tasksData = useTasks();
  const [anchor, setAnchor] = useState(initialDate ?? today);
  const [miniMonth, setMiniMonth] = useState(anchor);
  useEffect(() => {
    if (initialDate) { setAnchor(initialDate); setMiniMonth(initialDate); }
  }, [initialDate]);
  const [view, setView] = useState<CalendarView>(() => window.matchMedia('(max-width: 768px)').matches ? 'agenda' : 'week');
  const [selected, setSelected] = useState<CalendarEvent>();
  const [draft, setDraft] = useState<EventDraft>();
  const tasksPreferenceKey = `dtl_calendar_show_tasks:${userId}`;
  const eventsPreferenceKey = `dtl_calendar_show_events:${userId}`;
  const [showTasks, setShowTasks] = useState(() => localStorage.getItem(tasksPreferenceKey) !== 'false');
  const [showEvents, setShowEvents] = useState(() => localStorage.getItem(eventsPreferenceKey) !== 'false');
  const notesPreferenceKey = `dtl_calendar_show_notes:${userId}`;
  const [showNotes, setShowNotes] = useState(() => localStorage.getItem(notesPreferenceKey) !== 'false');
  useEffect(() => { localStorage.setItem(notesPreferenceKey, String(showNotes)); }, [showNotes, notesPreferenceKey]);
  const [showEarlyHours, setShowEarlyHours] = useState(false);
  useEffect(() => { localStorage.setItem(tasksPreferenceKey, String(showTasks)); }, [showTasks, tasksPreferenceKey]);
  useEffect(() => { localStorage.setItem(eventsPreferenceKey, String(showEvents)); }, [showEvents, eventsPreferenceKey]);
  const ownerName = userName.replace(/^quản trị viên(?=\s|$)/iu, 'Quản trị viên');
  const range = viewRange(anchor, view);
  const data = useCalendarEvents(toTimestamp(range.start), toTimestamp(range.end), showEvents, showNotes);
  const miniDays = monthDays(miniMonth);
  const miniData = useCalendarDays(dateKey(miniDays[0]), dateKey(addDays(miniDays[41], 1)));
  const deadlineData = useTaskRange(dateKey(range.start), dateKey(range.end));
  const [openError, setOpenError] = useState('');
  const todayKey = vietnamDay(tasksData.now);
  const deadlineCount = deadlineData.total;
  const visibleTasks = showTasks ? deadlineData.tasks : [];
  const inCurrentPeriod = view === 'week' ? dateKey(startOfWeek(anchor)) === dateKey(startOfWeek(today()))
    : view === 'month' ? dateKey(anchor).slice(0, 7) === todayKey.slice(0, 7) : dateKey(anchor) === todayKey;

  const selectDate = (date: Date) => { setAnchor(date); setMiniMonth(date); };
  const navigate = (direction: number) => {
    selectDate(view === 'month' ? addMonths(anchor, direction) : addDays(anchor, direction * (view === 'week' ? 7 : 30)));
  };
  const opening = useLatestRequest();
  const onCreate = (value: EventDraft) => { opening.cancel(); setOpenError(''); setSelected(undefined); setDraft(value); };
  const onSelect = async (event: CalendarEvent, day?: string) => {
    const controller = opening.start();
    setOpenError('');
    try { const value = await calendarApi.get(event.id, controller.signal); if (!controller.signal.aborted) { setSelected(value); setDraft({ date: day ? parseDate(day) : anchor }); } }
    catch (reason) { if (!controller.signal.aborted) setOpenError(reason instanceof Error ? reason.message : 'Không tải được sự kiện.'); }
  };
  const close = () => { opening.cancel(); setSelected(undefined); setDraft(undefined); };
  const weekEnd = addDays(startOfWeek(anchor), 6);
  const heading = view === 'week'
    ? `${formatDate(startOfWeek(anchor), { day: 'numeric', month: 'numeric' })} – ${formatDate(weekEnd, { day: 'numeric', month: 'numeric', year: 'numeric' })}`
    : view === 'agenda'
      ? `${formatDate(anchor)} – ${formatDate(addDays(anchor, 29))}`
      : formatDate(anchor, { month: 'long', year: 'numeric' });
  const viewProps = { anchor, events: data.events.filter(event => event.scheduled_note_id ? showNotes : showEvents), tasks: visibleTasks, onCreate, onSelect };

  return <div className={`calendar-page ${sharingControls ? 'has-sharing' : ''}`}>
    <div className="calendar-page-heading"><div className="calendar-page-heading-icon"><FeatureIcon name="calendar" size={34} /></div><div><h1>Lịch làm việc</h1></div></div>
    <div className="calendar-shell">
      <aside className="calendar-sidebar">
        <button type="button" className="calendar-create-button" onClick={() => onCreate({ date: anchor })}><Plus size={25} /><span>Tạo sự kiện</span></button>
        <MiniCalendar month={miniMonth} selected={anchor} onMonthChange={setMiniMonth} onSelect={selectDate} events={[]} tasks={[]} counts={miniData.days} showEvents={showEvents} showNotes={showNotes} showTasks={showTasks} highlightWeek={view === 'week'} />
        <div className="calendar-sidebar-section"><span className="calendar-eyebrow">LỊCH CỦA TÔI</span><h3 className="calendar-owner-name">{ownerName}</h3><label className="calendar-task-toggle calendar-event-toggle"><input type="checkbox" aria-label="Hiện sự kiện" checked={showEvents} onChange={event => setShowEvents(event.target.checked)} /><span>Sự kiện</span><span className="calendar-toggle-count" title="Số sự kiện trong khoảng đang xem"><AnimatedCount value={data.eventTotal} /></span></label><label className="calendar-task-toggle calendar-deadline-toggle"><input type="checkbox" aria-label="Hiện việc cần làm" checked={showTasks} onChange={event => setShowTasks(event.target.checked)} /><span>Việc cần làm</span><span className="calendar-toggle-count" title="Số hạn công việc trong khoảng đang xem"><AnimatedCount value={deadlineCount} /></span></label><label className="calendar-task-toggle calendar-note-toggle"><input type="checkbox" aria-label="Hiện ghi chú" checked={showNotes} onChange={event => setShowNotes(event.target.checked)} /><span>Ghi chú</span><span className="calendar-toggle-count" title="Số ghi chú đã đặt lịch trong khoảng đang xem"><AnimatedCount value={data.noteTotal} /></span></label><div className="calendar-event-legend-section"><h4>Trạng thái sự kiện và ghi chú</h4><EventStatusLegend /></div></div>
        {sharingControls}
        <div className="calendar-sidebar-note"><CalendarDays size={18} /><p>Lịch riêng của bạn.<br />Hiển thị theo giờ Việt Nam (UTC+7).</p></div>
      </aside>
      <section className="calendar-main" aria-label="Lịch cá nhân">
        <div className="calendar-toolbar">
          <div className="calendar-toolbar-navigation"><button type="button" className="btn btn-outline btn-sm" disabled={inCurrentPeriod} onClick={() => selectDate(today())}>Hôm nay</button>
            <button type="button" className="calendar-icon-button" aria-label="Khoảng thời gian trước" onClick={() => navigate(-1)}><ChevronLeft size={20} /></button>
            <button type="button" className="calendar-icon-button" aria-label="Khoảng thời gian sau" onClick={() => navigate(1)}><ChevronRight size={20} /></button>
            <h2>{heading}</h2>
          </div>
          <div className="calendar-toolbar-actions"><button type="button" className="calendar-icon-button" title="Tải lại" disabled={data.loading} aria-label="Làm mới lịch" onClick={() => { data.refresh(); tasksData.refresh(); }}><RefreshCw size={17} className={data.loading ? 'calendar-spin' : ''} /></button>
            {view === 'week' && <label className="calendar-night-toggle" title="Hiện khung giờ 00:00–06:00"><input type="checkbox" aria-label="Hiện khung giờ đêm" checked={showEarlyHours} onChange={event => setShowEarlyHours(event.target.checked)} /><span>Hiện khung giờ đêm</span></label>}
            <div className="calendar-view-switch" role="group" aria-label="Chế độ xem lịch">{([{ value: 'week', label: 'Tuần' }, { value: 'month', label: 'Tháng' }, { value: 'agenda', label: 'Danh sách' }] as const).map(option => <button type="button" key={option.value} aria-pressed={view === option.value} className={view === option.value ? 'is-active' : ''} onClick={() => setView(option.value)}>{option.label}</button>)}</div>
            <button type="button" className="btn btn-primary btn-sm calendar-mobile-create" onClick={() => onCreate({ date: anchor })}><Plus size={16} /> Tạo</button>
          </div>
        </div>
        <div className="calendar-status" aria-live="polite"><button type="button" className={`calendar-count-chip ${showEvents ? 'is-active' : ''}`} aria-label="Bật/tắt sự kiện" aria-pressed={showEvents} title="Bật/tắt hiển thị sự kiện" onClick={() => setShowEvents(value => !value)}><AnimatedCount value={data.eventTotal} /> sự kiện</button><button type="button" className={`calendar-count-chip ${showNotes ? 'is-active' : ''}`} aria-label="Bật/tắt ghi chú" aria-pressed={showNotes} title="Bật/tắt hiển thị ghi chú" onClick={() => setShowNotes(value => !value)}><AnimatedCount value={data.noteTotal} /> ghi chú</button><button type="button" className={`calendar-count-chip ${showTasks ? 'is-active' : ''}`} aria-label="Bật/tắt hạn công việc" aria-pressed={showTasks} title="Bật/tắt hiển thị việc cần làm" onClick={() => setShowTasks(value => !value)}><AnimatedCount value={deadlineCount} /> công việc</button>{(data.loading || deadlineData.loading || tasksData.loading) && <span>Đang tải lịch…</span>}</div>
        {(data.truncated || deadlineData.truncated) && <p className="calendar-error-state" role="status">Chỉ hiển thị tối đa 500 mục lịch và 500 hạn công việc. Còn nhiều mục; hãy thu hẹp khoảng xem.</p>}
        {(openError || miniData.error) && <p className="calendar-error-state" role="alert">{openError || miniData.error}</p>}
        {deadlineData.error && <p className="calendar-error-state" role="alert">{deadlineData.error}</p>}
        {tasksData.error && <p className="calendar-error-state" role="alert">{tasksData.error}</p>}
        {showTasks && <OverdueGroup compact />}
        {data.error ? <div className="calendar-error-state" role="alert"><p>{data.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={data.refresh}>Thử lại</button></div>
          : <div className="calendar-view-content" aria-busy={data.loading}>
            {view === 'week' && <WeekView {...viewProps} showEarlyHours={showEarlyHours} onShowDay={date => { selectDate(date); setView('agenda'); }} />}
            {view === 'month' && <MonthView {...viewProps} onShowDay={date => { selectDate(date); setView('agenda'); }} />}
            {view === 'agenda' && !data.loading && <AgendaView {...viewProps} />}
          </div>}
      </section>
    </div>
    {draft && <CalendarItemModal event={selected} draft={draft} onClose={close} onSave={data.save} onDelete={data.remove} />}
    <span className="calendar-sr-only">Ngày đang chọn: {dateKey(anchor)}</span>
  </div>;
}

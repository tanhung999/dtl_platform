import { eventTooltip } from './itemTooltip';
import { CalendarItemTitle } from './components/CalendarItemTitle';
import { AnimatedCount } from '../../components/AnimatedCount';
import { useState } from 'react';
import { useLatestRequest } from '../../services/useLatestRequest';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { CSSProperties } from 'react';
import { addDays, dateKey, eventDayLabel, eventsOnDay, formatDate, startOfWeek, today, toTimestamp, WEEKDAYS } from './dateUtils';
import { CalendarEvent, EventDraft } from './types';
import { useCalendarEvents } from './hooks/useCalendarEvents';
import { CalendarItemModal } from './components/CalendarItemModal';
import { DeadlineRow } from './components/DeadlineRow';
import { OverdueGroup } from './components/OverdueGroup';
import { useTaskRange } from '../tasks/useTaskRange';
import { useTasks } from '../tasks/context/TasksContext';
import { isOverdue, sortTasks, vietnamDay } from '../tasks/deadlineUtils';
import './calendar.css';
import { eventStatus } from './eventStatus';
import { EventStatusBadge } from './components/EventStatusBadge';
import { calendarApi } from './api';
import { useCalendarDays } from './hooks/useCalendarDays';
import { Task } from '../../types';
import { FeatureIcon } from '../../components/FeatureIcon';

interface Props { onOpenCalendar: (date: Date) => void }

export function CalendarWidget({ onOpenCalendar }: Props) {
  const tasksData = useTasks();
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<CalendarEvent>();
  const [draft, setDraft] = useState<EventDraft>();
  const weekStart = startOfWeek(date);
  const deadlineData = useTaskRange(dateKey(weekStart), dateKey(addDays(weekStart, 7)));
  const data = useCalendarEvents(toTimestamp(weekStart), toTimestamp(addDays(weekStart, 7)));
  const dayData = useCalendarDays(dateKey(weekStart), dateKey(addDays(weekStart, 7)));
  const [openError, setOpenError] = useState('');
  const opening = useLatestRequest();
  const openEvent = async (event: CalendarEvent) => {
    const controller = opening.start();
    setOpenError('');
    try { const value = await calendarApi.get(event.series_id ?? event.id, controller.signal); if (!controller.signal.aborted) { setSelected(value); setDraft({ date, occurrenceAt: event.starts_at }); } }
    catch (reason) { if (!controller.signal.aborted) setOpenError(reason instanceof Error ? reason.message : 'Không tải được sự kiện.'); }
  };
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = vietnamDay(tasksData.now);
  const isToday = dateKey(date) === todayKey;
  const deadlines = sortTasks(deadlineData.tasks.filter(task => task.due_date === dateKey(date)));
  const overdueTasks = deadlines.filter(task => isOverdue(task, tasksData.now));
  const pendingTasks = deadlines.filter(task => !task.is_completed && !isOverdue(task, tasksData.now));
  const completedTasks = deadlines.filter(task => task.is_completed);
  const hasOverdue = isToday ? tasksData.counts.OVERDUE > 0 : overdueTasks.length > 0;
  const events = eventsOnDay(data.events, date);
  const initialCalendarLoading = data.loading && !data.page;
  const initialDeadlineLoading = deadlineData.loading && !deadlineData.page;
  const renderEvent = (event: CalendarEvent) => {
    const status = eventStatus(event, tasksData.now, dateKey(date));
    return <button type="button" key={event.id} data-event-id={event.id} data-event-status={status.key} className={`calendar-widget-event ${event.scheduled_note_id ? 'is-note' : ''}`} data-tooltip={eventTooltip(event, tasksData.now)} style={{ '--event-color': status.color } as CSSProperties}
      onClick={() => { void openEvent(event); }}><span className="calendar-widget-event-marker" /><span><strong><CalendarItemTitle event={event} /></strong><EventStatusBadge status={status} /><span className="calendar-widget-event-time">{eventDayLabel(event, dateKey(date))}</span>{event.location && <span className="calendar-widget-event-location"><MapPin size={11} />{event.location}</span>}</span></button>;
  };
  const eventGroups = [
    { key: 'all-day', title: 'Sự kiện cả ngày', items: events.filter(event => event.is_all_day && !event.scheduled_note_id) },
    { key: 'timed', title: 'Sự kiện theo giờ', items: events.filter(event => !event.is_all_day && !event.scheduled_note_id) },
    { key: 'notes-all-day', title: 'Ghi chú cả ngày', items: events.filter(event => event.is_all_day && event.scheduled_note_id) },
    { key: 'notes-timed', title: 'Ghi chú theo giờ', items: events.filter(event => !event.is_all_day && event.scheduled_note_id) },
  ];
  const renderTasks = (key: string, title: string, items: Task[]) => items.length > 0 &&
    <section className="calendar-widget-group" data-calendar-group={key} aria-label={title}><h4>{title}<span><AnimatedCount value={items.length} /></span></h4>{items.map(task => <DeadlineRow key={task.id} task={task} />)}</section>;
  const close = () => { opening.cancel(); setSelected(undefined); setDraft(undefined); };

  return <div className="glass-panel widget-box calendar-widget">
    <div className="widget-header"><div className="widget-title"><FeatureIcon name="calendar" /><span>DT Calendar</span></div>
      <button type="button" className="btn btn-secondary btn-sm" aria-label="Tạo sự kiện" title="Tạo sự kiện" onClick={() => { opening.cancel(); setOpenError(''); setSelected(undefined); setDraft({ date }); }}><Plus size={14} /><span>Thêm</span></button>
    </div>
    <div className="calendar-widget-date"><div><span className="calendar-eyebrow">{dateKey(date) === todayKey ? 'HÔM NAY' : 'LỊCH TRONG NGÀY'}</span><h3>{formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</h3></div>
      <div className="calendar-inline-actions"><button type="button" className="calendar-icon-button" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={17} /></button><button type="button" className="calendar-icon-button" aria-label="Ngày sau" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={17} /></button></div>
    </div>
    {(data.truncated || deadlineData.truncated) && <p role="status">Đang hiển thị một phần dữ liệu. Mở Lịch và chọn “Tải thêm” để xem đầy đủ.</p>}
    {(openError || dayData.error) && <p role="alert">{openError || dayData.error}</p>}
    <div className="calendar-widget-week">{days.map((day, index) => {
      const dayTasks = deadlineData.tasks.filter(task => task.due_date === dateKey(day));
      const hasItems = dayData.days ? dayData.days[dateKey(day)]?.events > 0 || dayData.days[dateKey(day)]?.notes > 0 || dayData.days[dateKey(day)]?.tasks > 0 : eventsOnDay(data.events, day).length > 0 || dayTasks.length > 0;
      const needsAttention = dayData.days ? dayData.days[dateKey(day)]?.attention : dayTasks.some(task => !task.is_completed && (task.priority === 'URGENT' || isOverdue(task, tasksData.now)));
      const description = hasItems ? (needsAttention ? 'Có công việc quá hạn hoặc gấp' : 'Có sự kiện, ghi chú hoặc công việc') : undefined;
      return <button type="button" key={dateKey(day)} data-date={dateKey(day)} data-has-items={hasItems} aria-label={formatDate(day, { dateStyle: 'full' })} aria-description={description} aria-pressed={dateKey(day) === dateKey(date)} onClick={() => setDate(day)} className={`${dateKey(day) === dateKey(date) ? 'is-selected' : ''} ${dateKey(day) === todayKey ? 'is-today' : ''}`}><span>{WEEKDAYS[index]}</span><strong>{day.getUTCDate()}</strong><span className="calendar-widget-day-marker">{hasItems && <span className={`calendar-widget-day-dot ${needsAttention ? 'needs-attention' : dateKey(day) < todayKey ? 'is-past' : dateKey(day) > todayKey ? 'is-future' : ''}`} title={description} aria-hidden="true" />}</span></button>;
    })}</div>
    <div className="calendar-widget-events" aria-live="polite" tabIndex={0} role="region" aria-label="Lịch và công việc trong ngày">
      {deadlineData.error && <p role="alert" className="calendar-error-state">{deadlineData.error}<button type="button" className="calendar-text-button" onClick={tasksData.refresh}>Thử lại</button></p>}
      {tasksData.error && <p role="alert" className="calendar-error-state">{tasksData.error}</p>}
      <OverdueGroup title="Việc quá hạn" items={isToday ? undefined : overdueTasks} />
      {renderTasks('deadlines', 'Công việc', pendingTasks)}
      {initialCalendarLoading || initialDeadlineLoading ? <p className="calendar-widget-message">Đang tải lịch…</p>
        : data.error ? <div role="alert" className="calendar-error-state"><p>{data.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={data.refresh}>Thử lại</button></div>
        : eventGroups.map(group => group.items.length > 0 && <section key={group.key} className="calendar-widget-group" data-calendar-group={group.key} aria-label={group.title}><h4>{group.title}<span><AnimatedCount value={group.items.length} /></span></h4>{group.items.map(renderEvent)}</section>)}
      {renderTasks('completed', 'Việc đã xong', completedTasks)}
      {!initialCalendarLoading && !initialDeadlineLoading && !data.error && !deadlineData.error && !events.length && !deadlines.length && !hasOverdue && <div className="calendar-widget-empty"><CalendarDays size={26} /><p>Chưa có sự kiện, ghi chú hoặc hạn công việc trong ngày</p></div>}
    </div>
    <div className="calendar-widget-footer"><button type="button" className="calendar-text-button" onClick={() => setDate(today())}>Về hôm nay</button><button type="button" className="calendar-text-button" onClick={() => onOpenCalendar(date)}>Mở lịch đầy đủ <ArrowUpRight size={15} /></button></div>
    {draft && <CalendarItemModal event={selected} draft={draft} onClose={close} onSave={data.save} onDelete={data.remove} />}
  </div>;
}

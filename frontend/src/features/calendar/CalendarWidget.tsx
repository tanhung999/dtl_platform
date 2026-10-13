import { AnimatedCount } from '../drag-feedback/AnimatedCount';
import { useRef, useState } from 'react';
import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { CSSProperties } from 'react';
import { addDays, dateKey, eventLabel, eventsOnDay, formatDate, startOfWeek, today, toTimestamp, WEEKDAYS } from './dateUtils';
import { CalendarEvent, EventDraft } from './types';
import { useCalendarEvents } from './hooks/useCalendarEvents';
import { EventModal } from './components/EventModal';
import { DeadlineRow } from './components/DeadlineRow';
import { OverdueGroup } from './components/OverdueGroup';
import { useTasks } from '../tasks/context/TasksContext';
import { isOverdue, sortTasks, vietnamDay } from '../tasks/deadlineUtils';
import './calendar.css';
import { eventStatus } from './eventStatus';
import { EventStatusBadge } from './components/EventStatusBadge';
import { CalendarDropDay } from '../task-calendar/CalendarDropDay';
import { useDragEdges } from '../drag-feedback/useDragEdges';

interface Props { onOpenCalendar: (date: Date) => void }

export function CalendarWidget({ onOpenCalendar }: Props) {
  const tasksData = useTasks();
  const [date, setDate] = useState(today);
  const weekStrip = useRef<HTMLDivElement>(null);
  const dragEdge = useDragEdges(weekStrip, date, setDate);
  const [selected, setSelected] = useState<CalendarEvent>();
  const [draft, setDraft] = useState<EventDraft>();
  const weekStart = startOfWeek(date);
  const data = useCalendarEvents(toTimestamp(weekStart), toTimestamp(addDays(weekStart, 7)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayKey = vietnamDay(tasksData.now);
  const isToday = dateKey(date) === todayKey;
  const overdueIds = new Set(isToday ? tasksData.overdue.map(task => task.id) : []);
  const deadlines = sortTasks(tasksData.tasks.filter(task => task.due_date === dateKey(date) && !overdueIds.has(task.id)));
  const events = eventsOnDay(data.events, date);
  const renderEvent = (event: CalendarEvent) => {
    const status = eventStatus(event, tasksData.now, dateKey(date));
    return <button type="button" key={event.id} data-event-id={event.id} data-event-status={status.key} className="calendar-widget-event" style={{ '--event-color': status.color } as CSSProperties}
      onClick={() => { setSelected(event); setDraft({ date }); }}><span className="calendar-widget-event-marker" /><span><strong>{event.title}</strong><EventStatusBadge status={status} /><span className="calendar-widget-event-time">{eventLabel(event)}</span>{event.location && <span className="calendar-widget-event-location"><MapPin size={11} />{event.location}</span>}</span></button>;
  };
  const eventGroups = [
    { key: 'all-day', title: 'Cả ngày', items: events.filter(event => event.is_all_day) },
    { key: 'timed', title: 'Sự kiện theo giờ', items: events.filter(event => !event.is_all_day) },
  ];
  const taskGroups = [
    { key: 'deadlines', title: 'Việc đến hạn', items: deadlines.filter(task => !task.is_completed) },
    { key: 'completed', title: 'Việc đã xong', items: deadlines.filter(task => task.is_completed) },
  ];
  const close = () => { setSelected(undefined); setDraft(undefined); };

  return <div className="glass-panel widget-box calendar-widget">
    <div className="widget-header"><div className="widget-title"><CalendarDays size={18} className="widget-title-icon" /><span>Lịch Cá Nhân (My Calendar)</span></div>
      <button type="button" className="calendar-icon-button" aria-label="Tạo sự kiện" onClick={() => { setSelected(undefined); setDraft({ date }); }}><Plus size={19} /></button>
    </div>
    <div className="calendar-widget-date"><div><span className="calendar-eyebrow">{dateKey(date) === todayKey ? 'HÔM NAY' : 'LỊCH TRONG NGÀY'}</span><h3>{formatDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</h3></div>
      <div className="calendar-inline-actions"><button type="button" className="calendar-icon-button" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={17} /></button><button type="button" className="calendar-icon-button" aria-label="Ngày sau" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={17} /></button></div>
    </div>
    <div className="calendar-widget-week" ref={weekStrip}>{days.map((day, index) => {
      const dayTasks = tasksData.tasks.filter(task => task.due_date === dateKey(day));
      const hasItems = eventsOnDay(data.events, day).length > 0 || dayTasks.length > 0;
      const needsAttention = dayTasks.some(task => !task.is_completed && (task.priority === 'URGENT' || isOverdue(task, tasksData.now)));
      const description = hasItems ? (needsAttention ? 'Có công việc quá hạn hoặc gấp' : 'Có sự kiện hoặc công việc') : undefined;
      return <CalendarDropDay key={dateKey(day)} date={dateKey(day)} hasItems={hasItems} label={formatDate(day, { dateStyle: 'full' })} description={description} selected={dateKey(day) === dateKey(date)} onClick={() => setDate(day)} className={`${dateKey(day) === dateKey(date) ? 'is-selected' : ''} ${dateKey(day) === todayKey ? 'is-today' : ''}`}><span>{WEEKDAYS[index]}</span><strong>{day.getUTCDate()}</strong><span className="calendar-widget-day-marker">{hasItems && <span className={`calendar-widget-day-dot ${needsAttention ? 'needs-attention' : ''}`} title={description} aria-hidden="true" />}</span></CalendarDropDay>;
    })}{dragEdge && <div className={`drag-edge-indicator is-${dragEdge}`} data-drag-edge={dragEdge} aria-hidden="true" />}</div>
    <div className="calendar-widget-events" aria-live="polite" tabIndex={0} role="region" aria-label="Lịch và công việc trong ngày">
      {tasksData.error && <p role="alert" className="calendar-error-state">{tasksData.error}</p>}
      {isToday && <OverdueGroup />}
      {data.loading ? <p className="calendar-widget-message">Đang tải lịch…</p>
        : data.error ? <div role="alert" className="calendar-error-state"><p>{data.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={data.refresh}>Thử lại</button></div>
        : eventGroups.map(group => group.items.length > 0 && <section key={group.key} className="calendar-widget-group" data-calendar-group={group.key} aria-label={group.title}><h4>{group.title}<span><AnimatedCount value={group.items.length} /></span></h4>{group.items.map(renderEvent)}</section>)}
      {taskGroups.map(group => group.items.length > 0 && <section key={group.key} className="calendar-widget-group" data-calendar-group={group.key} aria-label={group.title}><h4>{group.title}<span><AnimatedCount value={group.items.length} /></span></h4>{group.items.map(task => <DeadlineRow key={task.id} task={task} />)}</section>)}
      {!data.loading && !data.error && !events.length && !deadlines.length && !overdueIds.size && <div className="calendar-widget-empty"><CalendarDays size={26} /><p>Chưa có sự kiện hoặc hạn công việc trong ngày</p><button type="button" className="calendar-text-button" onClick={() => setDraft({ date })}>+ Thêm lịch cho ngày này</button></div>}
    </div>
    <div className="calendar-widget-footer"><button type="button" className="calendar-text-button" onClick={() => setDate(today())}>Về hôm nay</button><button type="button" className="calendar-text-button" onClick={() => onOpenCalendar(date)}>Mở lịch đầy đủ <ArrowUpRight size={15} /></button></div>
    {draft && <EventModal event={selected} draft={draft} onClose={close} onSave={data.save} onDelete={data.remove} />}
  </div>;
}

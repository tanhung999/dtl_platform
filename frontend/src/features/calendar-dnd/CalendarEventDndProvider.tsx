import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragOverlay, useDndMonitor } from '@dnd-kit/core';
import { X } from 'lucide-react';
import { request } from '../../services/api';
import { CalendarEvent } from '../calendar/types';
import { eventTime, formatDate, parseDate } from '../calendar/dateUtils';
import { deadlineDropTarget } from '../task-calendar/deadlineDropTargets';
import { EventDragData, EventSchedule, eventSchedule, slotMinute } from './eventSchedule';
import './calendar-dnd.css';
import { vietnamDay } from '../tasks/deadlineUtils';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { useDragFeedback } from '../drag-feedback/DragFeedbackProvider';
import { highlightChange, shakeSource } from '../drag-feedback/changeHighlight';
import { revertDragView } from '../drag-feedback/dragFeedbackEvents';
import { useDragToast } from '../drag-feedback/useDragToast';

const Context = createContext<{ busy: boolean; label: string }>({ busy: false, label: '' });
export const useEventDragState = () => useContext(Context);
const scheduleLabel = (schedule: EventSchedule) => schedule.is_all_day ? 'Cả ngày' : `${eventTime(schedule.starts_at)} – ${eventTime(schedule.ends_at)}`;

export function CalendarEventDndProvider({ children }: { children: ReactNode }) {
  const feedback = useDragFeedback();
  const [active, setActive] = useState<EventDragData>(), [preview, setPreview] = useState<EventSchedule>();
  const activeRef = useRef<EventDragData>(), pointer = useRef<{ x: number; y: number }>(), locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const { notice, setNotice, hoverProps } = useDragToast<{ text: string; error?: boolean; undo?: { original: CalendarEvent; updated: CalendarEvent; dragId: string } }>(busy);
  useEffect(() => {
    const mouse = (event: MouseEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; };
    const touch = (event: TouchEvent) => { if (event.touches[0]) pointer.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
    document.addEventListener('mousemove', mouse, true); document.addEventListener('touchmove', touch, true);
    return () => { document.removeEventListener('mousemove', mouse, true); document.removeEventListener('touchmove', touch, true); };
  }, []);
  const write = async (event: CalendarEvent, schedule: EventSchedule) => {
    try { return await request<CalendarEvent>(`/api/calendar/events/${encodeURIComponent(event.id)}/schedule`, { method: 'PATCH', body: JSON.stringify({ ...schedule, expected_updated_at: event.updated_at }) }); }
    finally { window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: ['calendar'] })); }
  };
  useDndMonitor({
    onDragStart: event => {
      setNotice(undefined); pointer.current = undefined;
      const source = event.active.data.current;
      if (source?.type === 'calendar-event') { const snapshot = { ...source } as EventDragData; activeRef.current = snapshot; setActive(snapshot); setPreview(undefined); }
    },
    onDragOver: event => {
      const target = deadlineDropTarget(event.over?.data.current), data = activeRef.current;
      if (target && data) setPreview(eventSchedule(data, target, slotMinute(target, pointer.current?.y, event.over?.data.current?.node?.getBoundingClientRect() ?? event.over?.rect)));
    },
    onDragMove: event => {
      const target = deadlineDropTarget(event.over?.data.current), data = activeRef.current;
      if (target && data) setPreview(eventSchedule(data, target, slotMinute(target, pointer.current?.y, event.over?.data.current?.node?.getBoundingClientRect() ?? event.over?.rect)));
    },
    onDragCancel: () => { activeRef.current = undefined; setActive(undefined); setPreview(undefined); },
    onDragEnd: async event => {
      const data = activeRef.current, target = deadlineDropTarget(event.over?.data.current);
      activeRef.current = undefined; setActive(undefined); setPreview(undefined);
      if (!data || !target || locked.current) return;
      const schedule = eventSchedule(data, target, slotMinute(target, pointer.current?.y, event.over?.data.current?.node?.getBoundingClientRect() ?? event.over?.rect));
      if (Date.parse(schedule.starts_at) === Date.parse(data.event.starts_at) && Date.parse(schedule.ends_at) === Date.parse(data.event.ends_at) && schedule.is_all_day === data.event.is_all_day) return;
      locked.current = true; setBusy(true);
      try { const updated = await write(data.event, schedule); highlightChange('event', data.event.id); setNotice({ text: `Đã cập nhật sự kiện · ${scheduleLabel(schedule)}`, undo: { original: data.event, updated, dragId: String(event.active.id) } }); }
      catch (reason) { revertDragView(String(event.active.id)); shakeSource(document.querySelector<HTMLElement>(`[data-drag-source-id="${CSS.escape(String(event.active.id))}"]`)); setNotice({ text: `Không lưu được, đã hoàn lại. ${reason instanceof Error ? reason.message : ''}`, error: true }); }
      finally { locked.current = false; setBusy(false); }
    },
  });
  const undo = async () => {
    if (!notice?.undo || locked.current) return;
    const { original, updated, dragId } = notice.undo; locked.current = true; setBusy(true);
    try { await write(updated, { starts_at: original.starts_at, ends_at: original.ends_at, is_all_day: original.is_all_day }); revertDragView(dragId); highlightChange('event', original.id); setNotice({ text: 'Đã hoàn tác sự kiện' }); }
    catch (reason) { setNotice({ text: reason instanceof Error ? reason.message : 'Không thể hoàn tác.', error: true }); }
    finally { locked.current = false; setBusy(false); }
  };
  const label = preview ? scheduleLabel(preview) : '';
  return <Context.Provider value={{ busy, label }}>{children}
    {createPortal(<DragOverlay zIndex={130} dropAnimation={null}>{active && <div data-feedback-preview={feedback.scope} className={`calendar-event-drag-preview drag-floating-preview ${feedback.valid === false ? 'is-invalid' : ''}`}><strong>{active.event.title}</strong><span>{preview ? `${formatDate(parseDate(vietnamDay(new Date(preview.starts_at))))} · ${label}` : scheduleLabel(active.event)}</span></div>}</DragOverlay>, document.body)}
    {notice && createPortal(<div className={`task-calendar-toast calendar-event-toast ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'} {...hoverProps}><span>{notice.text}</span>{notice.undo && <button disabled={busy} onClick={undo}>Hoàn tác</button>}<button disabled={busy} aria-label="Đóng thông báo sự kiện" onClick={() => setNotice(undefined)}><X size={16} /></button></div>, document.body)}
  </Context.Provider>;
}

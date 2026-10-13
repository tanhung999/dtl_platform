import { createContext, ReactNode, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDndMonitor } from '@dnd-kit/core';
import { Task } from '../../types';
import { DeadlineDropTarget, deadlineDropTarget } from '../task-calendar/deadlineDropTargets';
import { EventDragData, EventSchedule, eventSchedule, slotMinute } from '../calendar-dnd/eventSchedule';
import { eventTime } from '../calendar/dateUtils';
import { vietnamDay } from '../tasks/deadlineUtils';
import { shortDeadlineDate } from '../task-calendar/deadlineDropTargets';
import { deadlineResultLabel, resolvedDeadlineTarget } from './dragResult';
import { shakeSource } from './changeHighlight';
import { PriorityBadge } from '../tasks/components/PriorityBadge';
import { deadlineLabel } from '../tasks/deadlineUtils';
import './drag-feedback.css';
import { revertDragView } from './dragFeedbackEvents';

interface State { source?: Record<string, any>; valid?: boolean; target?: DeadlineDropTarget; label: string; schedule?: EventSchedule }
interface Feedback extends State { scope: string; pointer: React.MutableRefObject<{ x: number; y: number } | undefined> }
const Context = createContext<Feedback | null>(null);
export function useDragFeedback() { const value = useContext(Context); if (!value) throw new Error('DragFeedbackProvider is required'); return value; }

export function DragFeedbackProvider({ children }: { children: ReactNode }) {
  const scope = useId(), pointer = useRef<{ x: number; y: number }>(), sourceRef = useRef<Record<string, any>>();
  const [state, setState] = useState<State>({ label: '' });
  const [settle, setSettle] = useState<{ from: DOMRect; to: { left: number; top: number }; title: string; task?: Task; text: string; valid: boolean }>();
  const flying = useRef<HTMLDivElement>(null), sourceNode = useRef<HTMLElement | null>(null);
  const origin = useRef<DOMRect>();
  useEffect(() => {
    const mouse = (event: MouseEvent) => { if (sourceRef.current) pointer.current = { x: event.clientX, y: event.clientY }; };
    const touch = (event: TouchEvent) => { if (sourceRef.current && event.touches[0]) pointer.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
    document.addEventListener('mousemove', mouse, true); document.addEventListener('touchmove', touch, true);
    return () => { document.removeEventListener('mousemove', mouse, true); document.removeEventListener('touchmove', touch, true); delete document.documentElement.dataset.dragCursor; };
  }, []);
  useEffect(() => { if (state.source) document.documentElement.dataset.dragCursor = state.valid === false ? 'not-allowed' : 'grabbing'; else delete document.documentElement.dataset.dragCursor; }, [state.source, state.valid]);
  useEffect(() => {
    if (!settle || !flying.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSettle(undefined); return; }
    const node = flying.current, x = settle.to.left - settle.from.left, y = settle.to.top - settle.from.top;
    const animation = node.animate([{ translate: '0px 0px', opacity: .9 }, { translate: `${x}px ${y}px`, opacity: settle.valid ? .15 : .5 }], { duration: settle.valid ? 180 : 200, easing: 'ease-out' });
    animation.finished.then(() => setSettle(undefined)).catch(() => {});
    return () => animation.cancel();
  }, [settle]);
  const update = (over: { data: { current?: any }; rect: { top: number; height: number } } | null) => {
    const source = sourceRef.current; if (!source) return;
    const raw = deadlineDropTarget(over?.data.current);
    let target = raw, label = '', schedule;
    if (raw && source.type === 'task') { target = resolvedDeadlineTarget(raw, pointer.current?.y, over?.data.current?.node?.getBoundingClientRect() ?? over?.rect); label = deadlineResultLabel(source.task, target); }
    else if (raw && source.type === 'calendar-event') {
      schedule = eventSchedule(source as EventDragData, raw, slotMinute(raw, pointer.current?.y, over?.data.current?.node?.getBoundingClientRect() ?? over?.rect));
      const start = shortDeadlineDate(vietnamDay(new Date(schedule.starts_at)));
      const end = shortDeadlineDate(vietnamDay(new Date(Date.parse(schedule.ends_at) - 1)));
      label = schedule.is_all_day ? `${start}${start === end ? '' : ` – ${end}`} · Cả ngày` : `${start} · ${eventTime(schedule.starts_at)} – ${eventTime(schedule.ends_at)}`;
    }
    else if (over) label = over.data.current?.pin ? 'Ghim lên đầu' : 'Đổi thứ tự';
    setState({ source, target, label, schedule, valid: !!over && (source.type === 'sortable' || !!raw) });
  };
  const finish = (over?: { rect: { left: number; top: number; width: number; height: number }; data: { current?: any } } | null) => {
    const source = sourceRef.current;
    const valid = !!over && (source?.type === 'sortable' || !!deadlineDropTarget(over.data.current));
    const preview = document.querySelector<HTMLElement>(`[data-feedback-preview="${CSS.escape(scope)}"]`);
    const destination = valid ? document.querySelector<HTMLElement>('[data-drag-ghost]')?.getBoundingClientRect() || over!.rect : sourceNode.current?.isConnected ? sourceNode.current.getBoundingClientRect() : origin.current;
    if (preview && destination && source) setSettle({ from: preview.getBoundingClientRect(), to: destination, title: source.task?.title || source.event?.title || source.label || 'Thẻ', task: source.task, text: state.label || (source.task ? deadlineLabel(source.task, true) : ''), valid });
    if (!valid) { shakeSource(sourceNode.current); if (source?.dragId) revertDragView(source.dragId); }
    if (valid) {
      const targetNode = over!.data.current?.node as HTMLElement | undefined;
      if (targetNode) { const token = String(Date.now()); targetNode.dataset.dropFlash = token; window.setTimeout(() => { if (targetNode.dataset.dropFlash === token) delete targetNode.dataset.dropFlash; }, 500); }
    }
    sourceRef.current = undefined; pointer.current = undefined; setState({ label: '' });
  };
  useDndMonitor({ onDragStart: ({ active, activatorEvent }) => {
    const data = active.data.current || {};
    sourceRef.current = { ...data, type: data.type || 'sortable', dragId: String(active.id) };
    pointer.current = activatorEvent instanceof MouseEvent ? { x: activatorEvent.clientX, y: activatorEvent.clientY } : undefined;
    const key = `[data-drag-source-id="${CSS.escape(String(active.id))}"]`;
    sourceNode.current = document.querySelector<HTMLElement>(key);
    origin.current = sourceNode.current?.getBoundingClientRect();
    setState({ source: sourceRef.current, label: '', valid: undefined });
  }, onDragMove: ({ over }) => update(over), onDragOver: ({ over }) => update(over), onDragEnd: ({ over }) => finish(over), onDragCancel: () => finish() });
  return <Context.Provider value={{ ...state, scope, pointer }}>{children}{settle && createPortal(<div ref={flying} className="drag-settle-copy drag-floating-preview" data-settle-valid={settle.valid} style={{ position: 'fixed', left: settle.from.left, top: settle.from.top, width: settle.from.width, zIndex: 150, pointerEvents: 'none' }}><strong>{settle.title}</strong><div className="drag-preview-meta">{settle.task && <PriorityBadge priority={settle.task.priority} />}<span>{settle.text}</span></div></div>, document.body)}</Context.Provider>;
}

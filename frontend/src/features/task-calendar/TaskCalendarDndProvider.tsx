import { MutationUncertainError } from '../../services/mutationRecovery';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CollisionDetection, DndContext, DragEndEvent, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, UniqueIdentifier, useSensor, useSensors } from '@dnd-kit/core';
import { X } from 'lucide-react';
import { Task } from '../../types';
import { useTasks } from '../tasks/context/TasksContext';
import './task-calendar.css';
import { deadlineDropLabel, deadlineDropTarget, shortDeadlineDate } from './deadlineDropTargets';
import { deadlineDropCoordinates } from './deadlineDropCoordinates';
import { deadlineCollisionDetection } from './deadlineCollisionDetection';
import { CalendarEventDndProvider } from '../calendar-dnd/CalendarEventDndProvider';
import { DragFeedbackProvider } from '../drag-feedback/DragFeedbackProvider';
import { resolvedDeadlineTarget } from '../drag-feedback/dragResult';
import { highlightChange, shakeSource } from '../drag-feedback/changeHighlight';
import { revertDragView } from '../drag-feedback/dragFeedbackEvents';
import { useDragToast } from '../drag-feedback/useDragToast';
import { TaskFloatingPreview } from './TaskFloatingPreview';

const PendingContext = createContext(false);
export const useDeadlineDropPending = () => useContext(PendingContext);
export { shortDeadlineDate } from './deadlineDropTargets';


interface Undo { previous: Task; applied: Task; dragId: string }
interface Notice { message: string; undo?: Undo; error?: boolean }

export function TaskCalendarDndProvider({ children }: { children: ReactNode }) {
  const data = useTasks();
  const [activeId, setActiveId] = useState<string>();
  const [pending, setPending] = useState(false);
  const { notice, setNotice, hoverProps } = useDragToast<Notice>(pending);
  const snapshot = useRef<Task>(), pointer = useRef<{ x: number; y: number }>();
  const locked = useRef(false);
  const keyboardTarget = useRef<UniqueIdentifier>();
  const coordinateGetter = useMemo(() => deadlineDropCoordinates(id => { keyboardTarget.current = id; }), []);
  const collisionDetection = useCallback<CollisionDetection>(args => deadlineCollisionDetection(args, keyboardTarget.current), []);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter, scrollBehavior: 'auto' }));
  const activeTask = activeId ? snapshot.current : undefined;
  useEffect(() => {
    const mouse = (event: MouseEvent) => { pointer.current = { x: event.clientX, y: event.clientY }; };
    const touch = (event: TouchEvent) => { if (event.touches[0]) pointer.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
    document.addEventListener('mousemove', mouse, true); document.addEventListener('touchmove', touch, true);
    return () => { document.removeEventListener('mousemove', mouse, true); document.removeEventListener('touchmove', touch, true); };
  }, []);

  const drop = async ({ active, over }: DragEndEvent) => {
    keyboardTarget.current = undefined;
    setActiveId(undefined);
    const task = snapshot.current; snapshot.current = undefined;
    const raw = deadlineDropTarget(over?.data.current);
    const target = raw && resolvedDeadlineTarget(raw, pointer.current?.y, over?.data.current?.node?.getBoundingClientRect() ?? over?.rect);
    if (!task || !target || locked.current || data.busyIds.includes(task.id)) return;
    const time = target.type === 'calendar-day' ? task.due_time : target.type === 'calendar-all-day' ? null : target.time!;
    if (task.due_date === target.date && task.due_time === time) return;
    locked.current = true; setPending(true); setNotice(undefined);
    try {
      const applied = await data.setDeadline(task, target.date, time);
      highlightChange('task', task.id);
      setNotice({ message: `Đã đặt hạn ${shortDeadlineDate(target.date)}${target.type === 'calendar-slot' ? ` ${time}` : target.type === 'calendar-all-day' ? ' · Cả ngày' : ''}`, undo: { previous: task, applied, dragId: String(active.id) } });
    } catch (reason) { revertDragView(String(active.id)); shakeSource(document.querySelector<HTMLElement>(`[data-drag-source-id="${CSS.escape(String(active.id))}"]`)); setNotice({ message: reason instanceof MutationUncertainError ? reason.message : `Không lưu được, đã hoàn lại. ${reason instanceof Error ? reason.message : ''}`, error: true }); data.refresh(); }
    finally { locked.current = false; setPending(false); }
  };
  const undo = async () => {
    if (!notice?.undo || locked.current) return;
    const { previous, applied, dragId } = notice.undo;
    locked.current = true; setPending(true);
    try { await data.setDeadline(applied, previous.due_date, previous.due_time); revertDragView(dragId); highlightChange('task', previous.id); setNotice({ message: 'Đã hoàn tác hạn công việc' }); }
    catch (reason) { setNotice({ message: reason instanceof Error ? reason.message : 'Không thể hoàn tác. Vui lòng thử lại.', error: true }); data.refresh(); }
    finally { locked.current = false; setPending(false); }
  };

  return <PendingContext.Provider value={pending}><DndContext autoScroll={{ canScroll: element => !element.classList.contains("calendar-week-scroll") }} sensors={sensors} collisionDetection={collisionDetection} onDragStart={({ active }) => { setNotice(undefined); keyboardTarget.current = undefined; snapshot.current = active.data.current?.task; pointer.current = undefined; setActiveId(active.data.current?.taskId); }} onDragCancel={() => { keyboardTarget.current = undefined; snapshot.current = undefined; setActiveId(undefined); }} onDragEnd={drop}
    accessibility={{ screenReaderInstructions: { draggable: 'Nhấn Space hoặc Enter để kéo công việc. Dùng phím mũi tên chọn ngày, Space hoặc Enter để đặt hạn, Escape để hủy.' }, announcements: {
      onDragStart: () => 'Đang kéo công việc. Chọn một ngày trên lịch để đặt hạn.',
      onDragOver: ({ over }) => { const target = deadlineDropTarget(over?.data.current); return target ? deadlineDropLabel(target) : 'Chưa chọn ngày hạn.'; },
      onDragEnd: ({ over }) => over?.data.current?.date ? `Đang đặt hạn ${shortDeadlineDate(over.data.current.date)}` : 'Đã hủy kéo công việc.',
      onDragCancel: () => 'Đã hủy kéo công việc.',
    } }}>
    <DragFeedbackProvider><CalendarEventDndProvider>{children}
    {createPortal(<DragOverlay dropAnimation={null} zIndex={100}>{activeTask && <TaskFloatingPreview task={activeTask} />}</DragOverlay>, document.body)}
    {notice && createPortal(<div className={`task-calendar-toast ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'} {...hoverProps}><span>{notice.message}</span>{notice.undo && <><span aria-hidden="true">·</span><button type="button" disabled={pending} onClick={undo}>{pending ? 'Đang hoàn tác…' : 'Hoàn tác'}</button></>}<button type="button" className="task-calendar-toast-close" aria-label="Đóng thông báo đặt hạn" disabled={pending} onClick={() => setNotice(undefined)}><X size={16} /></button></div>, document.body)}
    </CalendarEventDndProvider></DragFeedbackProvider></DndContext></PendingContext.Provider>;
}

import { useId, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CalendarEvent } from '../calendar/types';
import { EventDragAction, EventDragData, EventLane } from './eventSchedule';
import { useEventDragState } from './CalendarEventDndProvider';

export function useCalendarEventDrag(event: CalendarEvent, sourceDay: string, action: EventDragAction = 'move', lane?: EventLane) {
  const instance = useId(), { busy } = useEventDragState();
  const data = useMemo<EventDragData>(() => ({ type: 'calendar-event', event, sourceDay, action, lane }), [event, sourceDay, action, lane?.left, lane?.width]);
  const drag = useDraggable({ id: `event:${instance}:${event.id}:${action}`, data, disabled: busy });
  return { ...drag, data, disabled: busy, dragId: `event:${instance}:${event.id}:${action}` };
}

export function EventResizeHandle({ event, day, edge, allDay = false, lane }: { event: CalendarEvent; day: string; edge: 'start' | 'end'; allDay?: boolean; lane?: EventLane }) {
  const drag = useCalendarEventDrag(event, day, edge, lane);
  const { active } = useEventDragState();
  return <button type="button" ref={drag.setNodeRef} disabled={drag.disabled} {...drag.attributes} {...drag.listeners} data-event-resize={edge} data-drag-source-id={drag.dragId} aria-label={`${edge === 'start' ? 'Đổi bắt đầu' : 'Đổi kết thúc'} ${event.title}`} title={active ? undefined : allDay ? 'Kéo để đổi ngày' : 'Kéo để đổi thời lượng · Bước 15 phút'} className={`calendar-event-resize ${allDay ? 'is-horizontal' : ''} is-${edge}`} onClick={event => event.stopPropagation()}><span /></button>;
}

import { useId, useMemo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CalendarEvent } from '../calendar/types';
import { EventDragAction, EventDragData } from './eventSchedule';
import { useEventDragState } from './CalendarEventDndProvider';

export function useCalendarEventDrag(event: CalendarEvent, sourceDay: string, action: EventDragAction = 'move') {
  const instance = useId(), { busy } = useEventDragState();
  const data = useMemo<EventDragData>(() => ({ type: 'calendar-event', event, sourceDay, action }), [event, sourceDay, action]);
  const drag = useDraggable({ id: `event:${instance}:${event.id}:${action}`, data, disabled: busy });
  return { ...drag, data, dragId: `event:${instance}:${event.id}:${action}` };
}

export function EventResizeHandle({ event, day, edge, allDay = false }: { event: CalendarEvent; day: string; edge: 'start' | 'end'; allDay?: boolean }) {
  const drag = useCalendarEventDrag(event, day, edge);
  return <button type="button" ref={drag.setNodeRef} {...drag.attributes} {...drag.listeners} data-event-resize={edge} data-drag-source-id={drag.dragId} aria-label={`${edge === 'start' ? 'Đổi bắt đầu' : 'Đổi kết thúc'} ${event.title}`} title={allDay ? 'Kéo để đổi ngày' : 'Kéo để đổi thời lượng · Bước 15 phút'} className={`calendar-event-resize ${allDay ? 'is-horizontal' : ''} is-${edge}`} onClick={event => event.stopPropagation()}><span /></button>;
}

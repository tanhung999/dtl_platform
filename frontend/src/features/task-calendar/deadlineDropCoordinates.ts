import { KeyboardCoordinateGetter, UniqueIdentifier } from '@dnd-kit/core';
import { deadlineDropTarget } from './deadlineDropTargets';

export const deadlineDropCoordinates = (onTarget: (id: UniqueIdentifier) => void): KeyboardCoordinateGetter => (event, { context }) => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.code) || !context.collisionRect) return;
  const targets = context.droppableContainers.getEnabled().filter(item => deadlineDropTarget(item.data.current));
  if (!targets.length) return;
  event.preventDefault();
  const current = targets.find(item => item.id === context.over?.id);
  const currentTarget = deadlineDropTarget(current?.data.current);
  let chosen;
  if (!currentTarget || currentTarget.type === 'calendar-day') {
    const days = targets.filter(item => item.data.current?.type === 'calendar-day').sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (days.length) {
      const index = days.findIndex(day => day.id === current?.id);
      const step = event.code === 'ArrowLeft' || event.code === 'ArrowUp' ? -1 : 1;
      chosen = days[event.code === 'Home' ? 0 : event.code === 'End' ? days.length - 1 : index < 0 ? 0 : Math.max(0, Math.min(days.length - 1, index + step))];
    } else {
      const allDay = targets.filter(item => item.data.current?.type === 'calendar-all-day').sort((a, b) => String(a.data.current?.date).localeCompare(String(b.data.current?.date)));
      chosen = event.code === 'End' ? allDay[allDay.length - 1] : allDay[0];
    }
  } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight' || event.code === 'Home' || event.code === 'End') {
    const row = targets.filter(item => item.data.current?.type === currentTarget.type && item.data.current?.time === currentTarget.time).sort((a, b) => String(a.data.current?.date).localeCompare(String(b.data.current?.date)));
    const index = row.findIndex(item => item.id === current?.id);
    chosen = row[event.code === 'Home' ? 0 : event.code === 'End' ? row.length - 1 : Math.max(0, Math.min(row.length - 1, index + (event.code === 'ArrowLeft' ? -1 : 1)))];
  } else {
    const column = targets.filter(item => item.data.current?.date === currentTarget.date && item.data.current?.type !== 'calendar-day').sort((a, b) => (a.data.current?.time || '').localeCompare(b.data.current?.time || ''));
    const index = column.findIndex(item => item.id === current?.id);
    chosen = column[Math.max(0, Math.min(column.length - 1, index + (event.code === 'ArrowUp' ? -1 : 1)))];
  }
  const node = chosen?.node.current;
  if (node) {
    onTarget(chosen!.id);
    node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const scroller = node.closest('.calendar-week-scroll');
    if (chosen?.data.current?.type === 'calendar-slot' && scroller) {
      const bounds = scroller.getBoundingClientRect();
      const top = scroller.querySelector('.calendar-week-all-day')?.getBoundingClientRect().bottom ?? bounds.top;
      const slot = node.getBoundingClientRect();
      if (slot.top < top) scroller.scrollTop -= top - slot.top;
      else if (slot.bottom > bounds.bottom) scroller.scrollTop += slot.bottom - bounds.bottom;
    }
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - context.collisionRect.width / 2, y: rect.top + rect.height / 2 - context.collisionRect.height / 2 };
  }
};

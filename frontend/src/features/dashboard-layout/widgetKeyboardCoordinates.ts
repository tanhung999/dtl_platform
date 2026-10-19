import { KeyboardCoordinateGetter } from '@dnd-kit/core';
import { COLUMN_IDS, WidgetColumns, WidgetId } from './widgetLayout';

export function widgetKeyboardCoordinates(getColumns: () => WidgetColumns, getTarget: () => string | undefined, setTarget: (id: string) => void): KeyboardCoordinateGetter {
  return (event, { context: { active, droppableRects } }) => {
    if (!active || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) return;
    event.preventDefault();
    const columns = getColumns(), current = getTarget() || String(active.id);
    const id = current.startsWith('widget:') ? current.slice(7) as WidgetId : undefined;
    const column = COLUMN_IDS.find(key => id ? columns[key].includes(id) : current === `widget-column:${key}`);
    if (!column) return;
    const index = id ? columns[column].indexOf(id) : 0;
    let target: string | undefined;
    if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
      const next = columns[column][index + (event.code === 'ArrowUp' ? -1 : 1)];
      if (next) target = `widget:${next}`;
    } else {
      const nextColumn = COLUMN_IDS[COLUMN_IDS.indexOf(column) + (event.code === 'ArrowLeft' ? -1 : 1)];
      if (nextColumn) {
        const next = columns[nextColumn][Math.min(index, columns[nextColumn].length - 1)];
        target = next ? `widget:${next}` : `widget-column:${nextColumn}`;
      }
    }
    const rect = target ? droppableRects.get(target) : undefined;
    if (!target || !rect) return;
    setTarget(target);
    return { x: rect.left, y: rect.top };
  };
}

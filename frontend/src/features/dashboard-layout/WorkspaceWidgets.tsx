import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripHorizontal, X } from 'lucide-react';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { TasksWidget } from '../tasks/TasksWidget';
import { NotesWidget } from '../notes/NotesWidget';
import { NoteFilter } from '../notes/noteView';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { TaskCalendarDndProvider } from '../task-calendar/TaskCalendarDndProvider';
import { dismissDragToasts, useDragToast } from '../drag-feedback/useDragToast';
import { COLUMN_IDS, ColumnId, moveWidget, WidgetColumns, WidgetId, WIDGETS } from './widgetLayout';
import { useWidgetLayout } from './useWidgetLayout';
import { widgetKeyboardCoordinates } from './widgetKeyboardCoordinates';
import './dashboard-layout.css';

function WidgetFrame({ id, host, disabled }: { id: WidgetId; host: HTMLElement; disabled: boolean }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({ id: `widget:${id}`, disabled, data: { type: 'dashboard-widget', widgetId: id } });
  const slot = useRef<HTMLDivElement>(null);
  // Portal hosts stay alive when frames change columns, preserving forms and inner DnD state.
  useLayoutEffect(() => {
    const target = slot.current!; target.appendChild(host);
    return () => { if (host.parentNode === target) target.removeChild(host); };
  }, [host]);
  const title = WIDGETS.find(widget => widget.id === id)!.title;
  return <div ref={setNodeRef} data-dashboard-widget={id} className={`dashboard-widget-frame ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? 'is-drop-target' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} className="dashboard-widget-handle" aria-label={`Di chuyển widget ${title}`} title={`Di chuyển widget ${title}`}><GripHorizontal size={17} /></button>
    <div ref={slot} />
  </div>;
}

function WidgetColumn({ column, ids, hosts, disabled }: { column: ColumnId; ids: WidgetId[]; hosts: Record<WidgetId, HTMLElement>; disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `widget-column:${column}`, disabled, data: { type: 'widget-column', column } });
  return <section ref={setNodeRef} data-widget-column={column} className={`col-${column} widget-board-column ${isOver ? 'is-over' : ''}`} aria-label={`Cột ${COLUMN_IDS.indexOf(column) + 1}`}>
    <SortableContext items={ids.map(id => `widget:${id}`)} strategy={verticalListSortingStrategy} disabled={disabled}>
      {ids.map(id => <WidgetFrame key={id} id={id} host={hosts[id]} disabled={disabled} />)}
    </SortableContext>
  </section>;
}

export function WorkspaceWidgets({ onOpenCalendar, onOpenNotes }: { onOpenCalendar: (date: Date) => void; onOpenNotes: (filter: NoteFilter) => void }) {
  const store = useWidgetLayout();
  const [active, setActive] = useState<WidgetId>();
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 768px)').matches);
  const origin = useRef<WidgetColumns>();
  const keyboardTarget = useRef<string>();
  const columnsRef = useRef(store.layout.columns); columnsRef.current = store.layout.columns;
  const keyboardCoordinates = useMemo(() => widgetKeyboardCoordinates(() => columnsRef.current, () => keyboardTarget.current, id => { keyboardTarget.current = id; }), []);
  const [hosts] = useState(() => {
    const nodes = {} as Record<WidgetId, HTMLElement>;
    for (const widget of WIDGETS) { nodes[widget.id] = document.createElement('div'); nodes[widget.id].className = 'widget-board-host'; }
    return nodes;
  });
  const { notice, setNotice, hoverProps } = useDragToast<{ text: string; error?: boolean; undo?: { columns: WidgetColumns; version: number } }>(store.busy);
  const disabled = mobile || !store.loaded || store.busy;
  useEffect(() => {
    const media = matchMedia('(max-width: 768px)'), changed = () => { setMobile(media.matches); if (media.matches) setActive(undefined); };
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates, scrollBehavior: 'auto' }));
  return <DndContext sensors={sensors} collisionDetection={args => {
    if (!args.pointerCoordinates) {
      if (keyboardTarget.current) return args.droppableContainers.some(item => item.id === keyboardTarget.current) ? [{ id: keyboardTarget.current }] : [];
      return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter(item => item.data.current?.type === 'dashboard-widget') });
    }
    const hits = pointerWithin(args);
    return hits.filter(hit => String(hit.id).startsWith('widget:')).length ? hits.filter(hit => String(hit.id).startsWith('widget:')) : hits;
  }} onDragStart={({ active }) => { dismissDragToasts(); keyboardTarget.current = undefined; origin.current = store.layout.columns; setActive(active.data.current?.widgetId); setNotice(undefined); }} onDragCancel={() => { keyboardTarget.current = undefined; setActive(undefined); origin.current = undefined; }} onDragEnd={async ({ active, over }) => {
    keyboardTarget.current = undefined; setActive(undefined);
    const previous = origin.current; origin.current = undefined;
    const id = active.data.current?.widgetId as WidgetId | undefined;
    if (!id || !over || !previous || disabled) return;
    if (JSON.stringify(previous) !== JSON.stringify(store.layout.columns)) return;
    const overWidget = over.data.current?.widgetId as WidgetId | undefined;
    const column = over.data.current?.column as ColumnId | undefined ?? COLUMN_IDS.find(key => overWidget && previous[key].includes(overWidget));
    if (!column || overWidget === id) return;
    let before = overWidget;
    // Within one column, moving down inserts after the hovered item.
    if (before && previous[column].includes(id) && previous[column].indexOf(id) < previous[column].indexOf(before)) {
      before = previous[column][previous[column].indexOf(before) + 1];
    }
    const next = moveWidget(previous, id, column, before);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    try { const updated = await store.save(next); setNotice({ text: 'Đã đổi bố cục', undo: { columns: previous, version: updated.version } }); }
    catch (reason) { setNotice({ text: `Không lưu được, đã hoàn lại. ${reason instanceof Error ? reason.message : ''}`, error: true }); }
  }}>
    {store.error && <p className="widget-board-error" role="alert">{store.error}</p>}
    <div data-widget-layout-version={store.layout.version} className={`dashboard-grid widget-board ${active ? 'is-widget-dragging' : ''}`}>
      {COLUMN_IDS.map(column => <WidgetColumn key={column} column={column} ids={store.layout.columns[column]} hosts={hosts} disabled={disabled} />)}
    </div>
    {/* Portal React context isolates widget dragging from task/event dragging;
        stable portal targets also prevent remounting a widget after moving it. */}
    <TaskCalendarDndProvider>
      {WIDGETS.map(widget => createPortal(widget.id === 'apps' ? <AppLauncherWidget /> : widget.id === 'bookmarks' ? <BookmarksWidget /> : widget.id === 'tasks' ? <TasksWidget /> : widget.id === 'notes' ? <NotesWidget onOpenAll={onOpenNotes} /> : <CalendarWidget onOpenCalendar={onOpenCalendar} />, hosts[widget.id], widget.id))}
    </TaskCalendarDndProvider>
    {createPortal(<DragOverlay dropAnimation={null}>{active && <div className="dashboard-widget-preview">{WIDGETS.find(widget => widget.id === active)!.title}</div>}</DragOverlay>, document.body)}
    {notice && createPortal(<div className={`task-calendar-toast widget-board-toast ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'} {...hoverProps}><span>{notice.text}</span>{notice.undo && <button type="button" disabled={store.busy || mobile} onClick={async () => {
      try { await store.save(notice.undo!.columns, notice.undo!.version); setNotice({ text: 'Đã hoàn tác bố cục' }); }
      catch (reason) { setNotice({ text: reason instanceof Error ? reason.message : 'Không thể hoàn tác.', error: true }); }
    }}>Hoàn tác</button>}<button type="button" disabled={store.busy} aria-label="Đóng thông báo bố cục" onClick={() => setNotice(undefined)}><X size={16} /></button></div>, document.body)}
  </DndContext>;
}

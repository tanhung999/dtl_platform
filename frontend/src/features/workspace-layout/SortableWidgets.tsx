import { CSSProperties, ReactNode, useState } from 'react';
import { closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor, pointerWithin, TouchSensor, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pin, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import './workspace-layout.css';
import { DragFeedbackProvider, useDragFeedback } from '../drag-feedback/DragFeedbackProvider';
import { useDragToast } from '../drag-feedback/useDragToast';
import { highlightChange, shakeSource } from '../drag-feedback/changeHighlight';

export function SortableWidgetGroup({ ids, disabled, revision = 0, pinned, onSort, children }: { ids: string[]; disabled: boolean; revision?: number; pinned?: Record<string, boolean>; onSort: (ids: string[], activeId: string, pin: boolean, restorePin?: boolean) => Promise<void>; children: ReactNode }) {
  const [active, setActive] = useState<{ id: string; label: string }>();
  const { notice, setNotice, hoverProps } = useDragToast<{ text: string; error?: boolean; undo?: { ids: string[]; id: string; pin?: boolean; version: number } }>(disabled);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <DndContext sensors={sensors} collisionDetection={args => {
    if (args.pointerCoordinates) {
      const hits = pointerWithin(args);
      const pin = hits.find(hit => hit.id === 'notes-pin-zone');
      if (pin) return [pin];
      if (hits.length) return hits;
      const nodes = args.droppableContainers.map(item => item.node.current?.closest('[data-sort-group]')).filter(Boolean) as Element[];
      if (!nodes.some(node => { const rect = node.getBoundingClientRect(); return args.pointerCoordinates!.x >= rect.left && args.pointerCoordinates!.x <= rect.right && args.pointerCoordinates!.y >= rect.top && args.pointerCoordinates!.y <= rect.bottom; })) return [];
    }
    return closestCenter(args);
  }} onDragStart={({ active }) => { setActive({ id: String(active.id), label: active.data.current?.label || 'Thẻ' }); setNotice(undefined); }} onDragCancel={() => setActive(undefined)} onDragEnd={async ({ active, over }) => {
    setActive(undefined); if (!over || disabled || active.id === over.id) return;
    const pin = over.id === 'notes-pin-zone', from = ids.indexOf(String(active.id)), to = ids.indexOf(String(over.id));
    if (from < 0 || (!pin && to < 0)) return;
    const next = pin ? [String(active.id), ...ids.filter(id => id !== active.id)] : arrayMove(ids, from, to);
    try { await onSort(next, String(active.id), pin); highlightChange('sort', String(active.id)); setNotice({ text: pin ? 'Đã ghim lên đầu' : 'Đã đổi thứ tự', undo: { ids: [...ids], id: String(active.id), pin: pinned?.[String(active.id)], version: revision + 1 } }); }
    catch (reason) { shakeSource(document.querySelector<HTMLElement>(`[data-sort-id="${globalThis.CSS.escape(String(active.id))}"]`)); setNotice({ text: `Không lưu được, đã hoàn lại. ${reason instanceof Error ? reason.message : ''}`, error: true }); }
  }} accessibility={{ screenReaderInstructions: { draggable: 'Nhấn Space để kéo thẻ. Dùng phím mũi tên đổi vị trí, Space để thả, Escape để hủy.' } }}>
    <DragFeedbackProvider><SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}>{children}</SortableContext><SortFloatingPreview active={active} />
    {notice && createPortal(<div className={`task-calendar-toast ${notice.error ? 'is-error' : ''}`} role={notice.error ? 'alert' : 'status'} {...hoverProps}><span>{notice.text}</span>{notice.undo && <button type="button" disabled={disabled} onClick={async () => {
      const undo = notice.undo!;
      if (revision !== undo.version) { setNotice({ text: 'Thứ tự đã thay đổi ở nơi khác; không thể hoàn tác.', error: true }); return; }
      try { await onSort(undo.ids, undo.id, false, undo.pin); highlightChange('sort', undo.id); setNotice({ text: 'Đã hoàn tác thứ tự' }); }
      catch (reason) { setNotice({ text: reason instanceof Error ? reason.message : 'Không thể hoàn tác.', error: true }); }
    }}>Hoàn tác</button>}<button type="button" disabled={disabled} aria-label="Đóng thông báo sắp xếp" onClick={() => setNotice(undefined)}><X size={16} /></button></div>, document.body)}
    </DragFeedbackProvider>
  </DndContext>;
}

export function SortableWidgetCard({ id, label, disabled, className, style, onClick, children }: { id: string; label: string; disabled: boolean; className?: string; style?: CSSProperties; onClick?: () => void; children: ReactNode }) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id, disabled, data: { type: 'sortable', label } });
  return <div ref={setNodeRef} data-sort-id={id} data-drag-source-id={id} className={`${className || ''} workspace-sort-card ${isDragging ? 'is-dragging' : ''}`} style={{ ...style, transform: CSS.Transform.toString(transform), transition }} onClick={onClick}>
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="workspace-sort-handle" aria-label={`Đổi thứ tự ${label}`} disabled={disabled} onClick={event => event.stopPropagation()}><GripVertical size={14} /></button>{children}
  </div>;
}

export function NotesPinZone({ disabled }: { disabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'notes-pin-zone', disabled, data: { pin: true } });
  return <div ref={setNodeRef} className={`notes-pin-zone ${isOver ? 'is-over' : ''}`}><Pin size={13} /><span>Ghim lên đầu</span><small>Kéo ghi chú vào đây</small></div>;
}

function SortFloatingPreview({ active }: { active?: { id: string; label: string } }) {
  const feedback = useDragFeedback();
  return createPortal(<DragOverlay dropAnimation={null} zIndex={120}>{active && <div data-feedback-preview={feedback.scope} className={`workspace-sort-preview drag-floating-preview ${feedback.valid === false ? 'is-invalid' : ''}`}><strong>{active.label}</strong></div>}</DragOverlay>, document.body);
}

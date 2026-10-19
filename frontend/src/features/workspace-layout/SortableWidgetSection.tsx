import { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext } from '@dnd-kit/sortable';

export function SortableWidgetSection({ id, ids, disabled, children }: { id: string; ids: string[]; disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id, disabled, data: { type: 'sort-section' } });
  return <SortableContext items={ids} strategy={rectSortingStrategy} disabled={disabled}><div ref={setNodeRef} data-sort-section={id} className="notes-grid">{children}</div></SortableContext>;
}

export function NotesDropArea({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: 'notes-reset-zone', disabled, data: { type: 'sort-reset' } });
  return <div ref={setNodeRef} data-sort-group="notes" className="notes-drop-area">{children}</div>;
}

export const REVERT_DRAG_VIEW = 'dtl:revert-drag-view';
export function revertDragView(id: string) { window.dispatchEvent(new CustomEvent(REVERT_DRAG_VIEW, { detail: id })); }

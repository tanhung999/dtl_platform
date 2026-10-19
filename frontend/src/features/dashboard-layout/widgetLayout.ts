export const WIDGETS = [
  { id: 'apps', title: 'Ứng dụng', column: 'launcher' },
  { id: 'bookmarks', title: 'Bookmarks', column: 'launcher' },
  { id: 'tasks', title: 'To-Do', column: 'tasks' },
  { id: 'calendar', title: 'Lịch cá nhân', column: 'notes' },
  { id: 'notes', title: 'Notes', column: 'notes' },
] as const;
export const COLUMN_IDS = ['launcher', 'tasks', 'notes'] as const;
export type ColumnId = typeof COLUMN_IDS[number];
export type WidgetId = typeof WIDGETS[number]['id'];
export type WidgetColumns = Record<ColumnId, WidgetId[]>;
export interface WidgetLayout { columns: WidgetColumns; version: number; schema_version: number }

export function normalizeWidgetColumns(saved: unknown): WidgetColumns {
  const result: WidgetColumns = { launcher: [], tasks: [], notes: [] }, seen = new Set<string>();
  const data = saved && typeof saved === 'object' ? saved as Record<string, unknown> : {};
  for (const column of COLUMN_IDS) {
    const items = data[column];
    if (!Array.isArray(items)) continue;
    for (const id of items) if (WIDGETS.some(widget => widget.id === id) && !seen.has(id)) {
      result[column].push(id as WidgetId); seen.add(id);
    }
  }
  for (const widget of WIDGETS) if (!seen.has(widget.id)) result[widget.column].push(widget.id);
  return result;
}

export function moveWidget(columns: WidgetColumns, id: WidgetId, column: ColumnId, before?: WidgetId): WidgetColumns {
  const result = Object.fromEntries(COLUMN_IDS.map(key => [key, columns[key].filter(item => item !== id)])) as WidgetColumns;
  const index = before ? result[column].indexOf(before) : -1;
  result[column].splice(index < 0 ? result[column].length : index, 0, id);
  return result;
}

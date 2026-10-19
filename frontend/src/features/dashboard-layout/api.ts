import { request } from '../../services/api';
import type { WidgetColumns, WidgetLayout } from './widgetLayout';
const endpoint = '/api/workspace/widgets';
export const widgetLayoutApi = {
  get: (signal?: AbortSignal) => request<WidgetLayout>(endpoint, { signal }),
  save: (columns: WidgetColumns, version: number) => request<WidgetLayout>(endpoint, {
    method: 'PUT', body: JSON.stringify({ columns, schema_version: 1, expected_version: version }),
  }),
};

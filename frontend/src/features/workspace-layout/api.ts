import { request } from '../../services/api';
import type { Layout, LayoutKind, Order } from './types';
export const workspaceOrderApi = {
  get: (signal?: AbortSignal) => request<Layout>('/api/workspace/layout?include_note_ids=false', { signal }),
  save: (kind: LayoutKind, ids: string[], version: number, pins?: Record<string, boolean>) => request<Order>(`/api/workspace/layout/${kind}`, {
    method: 'PUT', body: JSON.stringify({ ids, expected_version: version, pin_changes: pins }),
  }),
};

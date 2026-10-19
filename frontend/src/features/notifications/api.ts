import { requestWithTimeout } from '../../services/requestTimeout';
import { NotificationFilter, NotificationPage, NotificationPreferences, NotificationSource, NotificationSummary } from './types';
const base = '/api/notifications';
export const notificationsApi = {
  summary: (signal?: AbortSignal) => requestWithTimeout<NotificationSummary>(base + '/summary', { signal }),
  list: (filter: NotificationFilter, source: NotificationSource | '', before?: string, signal?: AbortSignal) => {
    const params = new URLSearchParams({ filter, limit: '25' });
    if (source) params.set('source', source); if (before) params.set('before', before);
    return requestWithTimeout<NotificationPage>(`${base}?${params}`, { signal });
  },
  state: (id: string, payload: { read?: boolean; dismissed?: boolean }) => requestWithTimeout<void>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  readAll: (through: string) => requestWithTimeout<void>(base + '/read-all', { method: 'POST', body: JSON.stringify({ through }) }),
  snooze: (id: string) => requestWithTimeout<void>(`${base}/${id}/snooze`, { method: 'POST' }),
  destination: (id: string) => requestWithTimeout<{ calendar_owner_id?: string; task_id?: string; target_app?: Exclude<NotificationSource, 'platform'>; action_path?: string }>(`${base}/${id}/destination`, { cache: 'no-store' }, 5000),
  preferences: (signal?: AbortSignal) => requestWithTimeout<NotificationPreferences>(base + '/preferences', { signal }),
  savePreferences: (payload: Partial<NotificationPreferences> & { expected_version: number }) => requestWithTimeout<NotificationPreferences>(base + '/preferences', { method: 'PATCH', body: JSON.stringify(payload) }),
};

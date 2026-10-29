import { requestWithTimeout } from '../../services/requestTimeout';
import { ApiError, getSessionKey } from '../../services/api';
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
  readAll: async (through: string) => {
    const session = getSessionKey();
    const options = { method: 'POST', body: JSON.stringify({ through }) };
    try { return await requestWithTimeout<void>(base + '/read-all', options); }
    catch (reason) {
      if (!(reason instanceof ApiError) || reason.status !== 503) throw reason;
      // This write is idempotent for a fixed cutoff. A transient busy response
      // gets one retry; notices delivered after that cutoff remain unread.
      await new Promise(resolve => setTimeout(resolve, 500));
      if (getSessionKey() !== session) throw new DOMException('Phiên đăng nhập đã thay đổi.', 'AbortError');
      return requestWithTimeout<void>(base + '/read-all', options);
    }
  },
  snooze: (id: string) => requestWithTimeout<void>(`${base}/${id}/snooze`, { method: 'POST' }),
  destination: (id: string) => requestWithTimeout<{ calendar_owner_id?: string; task_id?: string; event_id?: string; note_id?: string; target_app?: Exclude<NotificationSource, 'platform'>; action_path?: string }>(`${base}/${id}/destination`, { cache: 'no-store' }, 5000),
  preferences: (signal?: AbortSignal) => requestWithTimeout<NotificationPreferences>(base + '/preferences', { signal }),
  savePreferences: (payload: Partial<NotificationPreferences> & { expected_version: number }) => requestWithTimeout<NotificationPreferences>(base + '/preferences', { method: 'PATCH', body: JSON.stringify(payload) }),
};

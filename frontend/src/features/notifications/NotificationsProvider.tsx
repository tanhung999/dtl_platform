import { appsApi } from '../apps/api';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { useTasks } from '../tasks/context/TasksContext';
import { useInvalidation } from '../realtime/useInvalidation';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { notificationsApi } from './api';
import { NotificationItem, NotificationSummary } from './types';
import './notifications.css';
interface State {
  userId: string; summary?: NotificationSummary; error: string; revision: number; busyIds: string[];
  refresh: () => void; state: (item: NotificationItem, payload: { read?: boolean; dismissed?: boolean }) => Promise<void>;
  snooze: (item: NotificationItem) => Promise<void>; readAll: () => Promise<void>; open: (item: NotificationItem) => Promise<void>;
}
const Context = createContext<State | null>(null);
export function NotificationsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const tasks = useTasks();
  const [summary, setSummary] = useState<NotificationSummary>(), [error, setError] = useState('');
  const [revision, refresh] = useInvalidation(), [busyIds, setBusyIds] = useState<string[]>([]);
  const busy = useRef(new Set<string>());
  useEffect(() => {
    let onlineTimer: ReturnType<typeof setTimeout>;
    const change = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('notifications')) refresh(); };
    const online = () => { clearTimeout(onlineTimer); onlineTimer = setTimeout(refresh, Math.random() * 2000); };
    window.addEventListener(WORKSPACE_CHANGED, change); window.addEventListener('focus', refresh); window.addEventListener('online', online);
    return () => { clearTimeout(onlineTimer); window.removeEventListener(WORKSPACE_CHANGED, change); window.removeEventListener('focus', refresh); window.removeEventListener('online', online); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    notificationsApi.summary(controller.signal).then(value => { if (!controller.signal.aborted) { setSummary(value); setError(''); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [revision, userId]);
  const mutate = async (id: string, action: () => Promise<void>) => {
    if (busy.current.has(id)) return;
    busy.current.add(id); setBusyIds([...busy.current]);
    try { await action(); } finally { busy.current.delete(id); setBusyIds([...busy.current]); refresh(); }
  };
  return <Context.Provider value={{ userId, summary, error, revision, busyIds, refresh,
    state: (item, payload) => mutate(item.id, () => notificationsApi.state(item.id, payload)),
    snooze: item => mutate(item.id, () => notificationsApi.snooze(item.id)),
    readAll: () => summary ? mutate('all', () => notificationsApi.readAll(summary.server_now)) : Promise.resolve(),
    open: async item => {
      await mutate(item.id, async () => {
        await notificationsApi.state(item.id, { read: true });
        if (item.state === 'deleted') return;
        const destination = await notificationsApi.destination(item.id);
        if (destination.calendar_owner_id) window.dispatchEvent(new CustomEvent('calendar:open-shared', { detail: destination.calendar_owner_id }));
        else if (destination.task_id) await tasks.openTask(destination.task_id);
        else if (destination.target_app) {
          const session = await appsApi.launchSubApp(destination.target_app, 15000);
          // Deep paths are retained by the integration API; existing apps currently
          // support only their normal SSO callback, so do not invent a redirect contract.
          window.location.assign(session.launch_url);
        }
      });
    },
  }}>{children}</Context.Provider>;
}
export function useNotifications() { const value = useContext(Context); if (!value) throw new Error('NotificationsProvider is required.'); return value; }

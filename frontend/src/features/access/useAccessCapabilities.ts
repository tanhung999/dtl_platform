import { useEffect, useState } from 'react';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { useInvalidation } from '../realtime/useInvalidation';
import { accessApi, Capabilities } from './api';

export function useAccessCapabilities(userId: string) {
  const [capabilities, setCapabilities] = useState<Capabilities>({ can_manage: false, can_share: false });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [revision, refresh] = useInvalidation();
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<string[]>).detail.includes('calendar-sharing')) refresh();
    };
    window.addEventListener(WORKSPACE_CHANGED, changed);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener(WORKSPACE_CHANGED, changed);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    accessApi.capabilities(controller.signal).then(value => {
      if (!controller.signal.aborted) { setCapabilities(value); setError(''); setLoading(false); }
    }).catch(reason => {
      if (!controller.signal.aborted) { setCapabilities({ can_manage: false, can_share: false }); setError(reason.message); setLoading(false); }
    });
    return () => controller.abort();
  }, [userId, revision]);
  return { ...capabilities, loading, error, refresh, revision };
}

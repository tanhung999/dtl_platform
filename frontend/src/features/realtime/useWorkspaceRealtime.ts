import { useEffect } from 'react';
import { clearSession, getStoredToken } from '../../services/api';

export const WORKSPACE_CHANGED = 'workspace:changed';

// Fetch supports Authorization headers without putting the token in an SSE URL.
export function useWorkspaceRealtime() {
  useEffect(() => {
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const connect = async () => {
      try {
        const response = await fetch('/api/workspace/stream', {
          headers: { Authorization: `Bearer ${getStoredToken()}` }, signal: controller.signal,
        });
        if (response.status === 401) {
          clearSession(); window.dispatchEvent(new Event('auth:unauthorized'));
          return;
        }
        if (!response.ok || !response.body) throw new Error('Realtime connection failed');
        failures = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data) window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED, { detail: JSON.parse(data.slice(6)).topics }));
          }
        }
      } catch { /* Reconnect after a transient network interruption. */ }
      if (!controller.signal.aborted) retryTimer = setTimeout(connect, Math.min(1000 * 2 ** failures++, 15_000));
    };
    void connect();
    return () => { controller.abort(); clearTimeout(retryTimer); };
  }, []);
}

import { useEffect } from 'react';
import { clearSession, ensureWorkspaceSession, getSessionKey, getStoredToken } from '../../services/api';
import { workspaceBootstrap, WorkspaceMessage } from '../../services/realtimeBootstrap';
export const WORKSPACE_CHANGED = 'workspace:changed';

export function useWorkspaceRealtime() {
  useEffect(() => {
    const session = ensureWorkspaceSession();
    let stopped = false, running = false, failures = 0;
    let retry: ReturnType<typeof setTimeout> | undefined, connection: AbortController | undefined;
    const currentSession = () => !stopped && getSessionKey() === session;
    const connect = async () => {
      if (!currentSession() || running) return;
      running = true; const current = new AbortController(); connection = current;
      let lastRead = Date.now(); const began = lastRead;
      const watchdog = setInterval(() => { if (Date.now() - lastRead > 45000) current.abort(); }, 10000);
      try {
        const response = await fetch('/api/workspace/stream', { headers: { Authorization: `Bearer ${getStoredToken()}` }, signal: current.signal });
        if (!currentSession()) return;
        if (response.status === 401) { stopped = true; clearSession(); window.dispatchEvent(new Event('auth:unauthorized')); return; }
        if (!response.ok || !response.body) throw new Error('Realtime connection failed');
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
        while (currentSession() && !current.signal.aborted) {
          const { value, done } = await reader.read(); if (done) break;
          if (!currentSession() || current.signal.aborted) break;
          lastRead = Date.now(); if (lastRead - began > 30000) failures = 0; buffer += decoder.decode(value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data && currentSession() && !current.signal.aborted) workspaceBootstrap.receive(JSON.parse(data.slice(6)) as WorkspaceMessage);
          }
        }
      } catch { /* Version comparison on reconnect recovers missed changes. */ }
      finally {
        clearInterval(watchdog); current.abort(); running = false;
        if (currentSession()) retry = setTimeout(connect, 500 + Math.random() * Math.min(1000 * 2 ** Math.min(failures++, 5), 30000));
      }
    };
    const online = () => { clearTimeout(retry); if (running) connection?.abort(); else retry = setTimeout(connect, Math.random() * 2000); };
    const stop = () => { stopped = true; clearTimeout(retry); connection?.abort(); };
    window.addEventListener('online', online); window.addEventListener('session:changed', stop); void connect();
    return () => { stop(); window.removeEventListener('online', online); window.removeEventListener('session:changed', stop); };
  }, []);
}

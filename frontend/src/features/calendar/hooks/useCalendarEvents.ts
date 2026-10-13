import { useCallback, useEffect, useRef, useState } from 'react';
import { calendarApi } from '../api';
import { CalendarEvent, CalendarEventInput } from '../types';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';

export function useCalendarEvents(start: string, end: string) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const previousRange = useRef('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const onChange = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('calendar')) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => window.removeEventListener(WORKSPACE_CHANGED, onChange);
  }, [refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const rangeKey = `${start}/${end}`;
    if (previousRange.current !== rangeKey) setEvents([]);
    previousRange.current = rangeKey;
    calendarApi.list(start, end, controller.signal)
      .then(data => { if (!controller.signal.aborted) setEvents(data); })
      .catch(reason => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải lịch.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [start, end, revision]);

  const save = async (payload: CalendarEventInput, id?: string) => {
    if (id) await calendarApi.update(id, payload);
    else await calendarApi.create(payload);
    refresh();
  };

  const remove = async (id: string) => {
    await calendarApi.remove(id);
    refresh();
  };

  return { events, loading, error, refresh, save, remove };
}

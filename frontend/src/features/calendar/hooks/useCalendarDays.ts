import { useEffect, useState } from 'react';
import { calendarApi } from '../api';
import { CalendarDays } from '../types';
import { useTasks } from '../../tasks/context/TasksContext';
import { WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';
import { useInvalidation } from '../../realtime/useInvalidation';
const daysCache = new Map<string, CalendarDays>();
export function useCalendarDays(start: string, end: string) {
  const { revision } = useTasks();
  const [calendarRevision, refresh] = useInvalidation();
  const key = `${start}/${end}`;
  const [data, setData] = useState<{ key: string; days: CalendarDays } | undefined>(()=>daysCache.has(key)?{key,days:daysCache.get(key)!}:undefined), [error, setError] = useState('');
  useEffect(() => {
    const change = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('calendar')) refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, change);
    return () => window.removeEventListener(WORKSPACE_CHANGED, change);
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController(); setError('');
    calendarApi.days(start, end, controller.signal)
      .then(days => { if (!controller.signal.aborted) { daysCache.set(key,days); setData({ key, days }); } })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [key, revision, calendarRevision]);
  return { days: data?.key === key ? data.days : undefined, error };
}

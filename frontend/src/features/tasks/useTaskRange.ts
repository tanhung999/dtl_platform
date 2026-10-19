import { useEffect, useState } from 'react';
import { Task } from '../../types';
import { tasksApi } from './api';
import { useTasks } from './context/TasksContext';
export function useTaskRange(start: string, end: string, enabled = true) {
  const { revision } = useTasks();
  const [data, setData] = useState<{ key: string; tasks: Task[]; total: number; truncated: boolean }>(), [error, setError] = useState('');
  const key = `${start}/${end}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController(); setError('');
    tasksApi.calendar(start, end, controller.signal).then(value => { if (!controller.signal.aborted) setData({ key, tasks: value.items, total: value.total, truncated: value.truncated }); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [key, revision, enabled]);
  return { tasks: data?.key === key ? data.tasks : [], total: data?.key === key ? data.total : 0, truncated: data?.key === key && data.truncated, error: enabled ? error : '', loading: enabled && !error && data?.key !== key };
}

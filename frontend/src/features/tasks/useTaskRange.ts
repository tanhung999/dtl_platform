import { useCallback } from 'react';
import { CalendarTaskGroup } from './types';
import { Task } from '../../types';
import { tasksApi, TaskRange } from './api';
import { useTasks } from './context/TasksContext';
import { useRangeCollection } from '../../services/useRangeCollection';
export function useTaskRange(start: string, end: string, enabled = true, taskGroup: CalendarTaskGroup = 'all') {
  const { revision } = useTasks();
  const fetchPage = useCallback((offset: number, signal: AbortSignal) => tasksApi.calendar(start, end, signal, offset, taskGroup), [start, end, taskGroup]);
  const data = useRangeCollection<Task, TaskRange>(`tasks/${start}/${end}/${taskGroup}`, revision, fetchPage, enabled);
  return { ...data, tasks: data.items };
}

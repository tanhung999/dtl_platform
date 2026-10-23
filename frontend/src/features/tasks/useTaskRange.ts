import { useCallback } from 'react';
import { Task } from '../../types';
import { tasksApi, TaskRange } from './api';
import { useTasks } from './context/TasksContext';
import { useRangeCollection } from '../../services/useRangeCollection';
export function useTaskRange(start: string, end: string, enabled = true) {
  const { revision } = useTasks();
  const fetchPage = useCallback((offset: number, signal: AbortSignal) => tasksApi.calendar(start, end, signal, offset), [start, end]);
  const data = useRangeCollection<Task, TaskRange>(`${start}/${end}`, revision, fetchPage, enabled);
  return { ...data, tasks: data.items };
}

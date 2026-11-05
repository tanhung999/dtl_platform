import { useCallback } from 'react';
import { Task } from '../../../types';
import { tasksApi } from '../../tasks/api';
import { CalendarTaskGroup } from '../../tasks/types';
import { useTasks } from '../../tasks/context/TasksContext';
import { useRangeCollection } from '../../../services/useRangeCollection';
import { OverdueGroup } from './OverdueGroup';

export function CalendarOverdueGroup({ taskGroup }: { taskGroup: CalendarTaskGroup }) {
  const { revision, now } = useTasks();
  const fetchPage = useCallback(async (offset: number, signal: AbortSignal) => {
    const page = await tasksApi.collection('OVERDUE', 'all', offset, 0, signal, undefined, undefined, 100, '', taskGroup);
    return { items: page.items, total: page.total, truncated: page.has_more };
  }, [taskGroup]);
  const data = useRangeCollection<Task, { items: Task[]; total: number; truncated: boolean }>(`calendar-overdue/${taskGroup}`, revision + Math.floor(now.getTime() / 60000), fetchPage, taskGroup !== 'none');
  return <>{data.error && <p className="calendar-error-state" role="alert">{data.error}</p>}<OverdueGroup compact items={data.items} total={data.total}>
    {data.truncated && <button type="button" className="btn btn-outline btn-sm" disabled={data.loading} onClick={() => { void data.loadMore(); }}>Tải thêm công việc quá hạn</button>}
  </OverdueGroup></>;
}

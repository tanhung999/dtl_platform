import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Task } from '../../../types';
import { tasksApi } from '../api';
import { TaskCollection, TaskFilter, TaskInput } from '../types';
import { sortTasks } from '../deadlineUtils';
import { TaskModal } from '../components/TaskModal';
import '../tasks.css';
import { useWorkspaceRealtime, WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';
import { useInvalidation } from '../../realtime/useInvalidation';
import { CreateAttempt } from '../../../services/mutationRecovery';
import { MutationStatus } from '../../mutations/MutationStatus';
import { ApiError } from '../../../services/api';

interface TasksState {
  tasks: Task[]; overdue: Task[]; now: Date;
  loading: boolean; error: string; busyIds: string[]; revision: number;
  counts: Record<TaskFilter, number>; filter: TaskFilter; setFilter: (filter: TaskFilter) => void;
  page?: TaskCollection; setOffset: (value: number) => void; setOverdueOffset: (value: number) => void;
  refresh: () => void; edit: (task: Task) => void; openTask: (id: string) => Promise<void>;
  create: (payload: TaskInput, attempt: CreateAttempt<TaskInput>) => Promise<void>;
  update: (id: string, payload: Partial<TaskInput> & { is_completed?: boolean }) => Promise<void>;
  setDeadline: (task: Task, date: string | null, time: string | null) => Promise<Task>;
  toggle: (task: Task) => Promise<void>; remove: (id: string, version?: number) => Promise<void>;
  overdueRequest: number; showOverdue: () => void; acknowledgeOverdue: () => void;
}
const Context = createContext<TasksState | null>(null);
const emptyCounts = { ALL: 0, PENDING: 0, DONE: 0, OVERDUE: 0 };
export function TasksProvider({ children }: { children: ReactNode }) {
  useWorkspaceRealtime();
  const [page, setPage] = useState<TaskCollection>();
  const [filter, selectFilter] = useState<TaskFilter>('ALL'), [offset, setOffset] = useState(0), [overdueOffset, setOverdueOffset] = useState(0);
  const cursors = useRef<Record<number, string>>({}), overdueCursors = useRef<Record<number, string>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busyIds, setBusyIds] = useState<string[]>([]);
  const scope = `${filter}/${offset}/${overdueOffset}`;
  const [loadedScope, setLoadedScope] = useState('');
  const [editing, setEditing] = useState<Task>(), [now, setNow] = useState(new Date()), [overdueRequest, setOverdueRequest] = useState(0);
  const [revision, refresh] = useInvalidation();
  const busy = useRef(new Set<string>()), mutation = useRef(0);
  const setFilter = (value: TaskFilter) => { if (value !== filter) cursors.current = {}; selectFilter(value); setOffset(0); };
  useEffect(() => {
    const controller = new AbortController(), version = mutation.current;
    setLoading(true);
    tasksApi.collection(filter, offset, overdueOffset, controller.signal, cursors.current[offset], overdueCursors.current[overdueOffset]).then(value => {
      if (!controller.signal.aborted && version === mutation.current) {
        if (value.next_cursor) cursors.current[value.offset + value.limit] = value.next_cursor;
        if (value.overdue_next_cursor) overdueCursors.current[value.overdue_offset + 25] = value.overdue_next_cursor;
        setPage(value); setLoadedScope(scope); setError('');
      }
    }).catch(reason => { if (!controller.signal.aborted) {
      if (reason instanceof ApiError && reason.status === 409) { cursors.current = {}; overdueCursors.current = {}; setOffset(0); setOverdueOffset(0); }
      setError(reason.message);
    } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, offset, overdueOffset, revision]);
  useEffect(() => {
    // Deadlines and form input use minute precision. No whole-workspace rerender every second.
    let timer: ReturnType<typeof setTimeout>, onlineTimer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20); };
    timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20);
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('tasks')) refresh(); };
    const focus = () => { setNow(new Date()); refresh(); };
    const online = () => { clearTimeout(onlineTimer); onlineTimer = setTimeout(focus, Math.random() * 2000); };
    const storage = (event: StorageEvent) => { if (event.key === 'dtl_tasks_changed') refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, changed); window.addEventListener('focus', focus); window.addEventListener('online', online); window.addEventListener('storage', storage);
    return () => { clearTimeout(timer); clearTimeout(onlineTimer); window.removeEventListener(WORKSPACE_CHANGED, changed); window.removeEventListener('focus', focus); window.removeEventListener('online', online); window.removeEventListener('storage', storage); };
  }, [refresh]);
  useEffect(() => {
    if (!page?.next_refresh_at) return;
    const delay = Date.parse(page.next_refresh_at) - Date.parse(page.server_now);
    const timer = setTimeout(() => { setNow(new Date()); refresh(); }, Math.min(2147483647, Math.max(50, delay + 20)));
    return () => clearTimeout(timer);
  }, [page?.next_refresh_at, page?.server_now, refresh]);
  const changed = () => { mutation.current++; localStorage.setItem('dtl_tasks_changed', `${Date.now()}:${mutation.current}`); refresh(); };
  const mutate = async (task: Task, payload: Partial<TaskInput> & { is_completed?: boolean; expected_deadline_version?: number }) => {
    if (busy.current.has(task.id)) throw new Error('Công việc đang được cập nhật. Vui lòng thử lại.');
    busy.current.add(task.id); setBusyIds([...busy.current]); mutation.current++;
    try {
      const updated = await tasksApi.update(task.id, { ...payload, expected_version: payload.expected_version ?? task.version });
      setPage(value => value && ({ ...value, items: value.items.map(t => t.id === task.id ? updated : t), overdue: value.overdue.map(t => t.id === task.id ? updated : t) }));
      changed(); return updated;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật công việc.'); refresh(); throw reason; }
    finally { busy.current.delete(task.id); setBusyIds([...busy.current]); }
  };
  const update = async (id: string, payload: Partial<TaskInput> & { is_completed?: boolean }) => {
    const task = editing?.id === id ? editing : [...(page?.items ?? []), ...(page?.overdue ?? [])].find(t => t.id === id);
    if (!task) throw new Error('Không tìm thấy công việc. Vui lòng mở lại.');
    await mutate(task, payload);
  };
  const create = async (payload: TaskInput, attempt: CreateAttempt<TaskInput>) => { try { await tasksApi.create(payload, attempt); } finally { changed(); } };
  const remove = async (id: string, version?: number) => {
    const task = editing?.id === id ? editing : [...(page?.items ?? []), ...(page?.overdue ?? [])].find(t => t.id === id);
    if (version === undefined && !task) throw new Error('Hãy mở lại công việc trước khi xóa.');
    try { await tasksApi.remove(id, version ?? task!.version); setPage(value => value && ({ ...value, items: value.items.filter(t => t.id !== id), overdue: value.overdue.filter(t => t.id !== id) })); }
    finally { changed(); }
  };
  const currentPage = loadedScope === scope ? page : undefined;
  const tasks = useMemo(() => sortTasks(currentPage?.items ?? []), [currentPage?.items]);
  return <Context.Provider value={{ tasks, overdue: page?.overdue ?? [], now, page: currentPage, counts: page?.counts ?? emptyCounts, filter, setFilter, setOffset, setOverdueOffset,
    revision, loading: (!page || loadedScope !== scope) && (loading || !error), error, busyIds, refresh, create, update, remove,
    openTask: async id => { setEditing(await tasksApi.get(id)); },
    edit: task => { tasksApi.get(task.id).then(setEditing).catch(reason => setError(reason.message)); },
    toggle: async task => { await mutate(task, { is_completed: !task.is_completed }); },
    setDeadline: (task, date, time) => mutate(task, { due_date: date, due_time: time, expected_deadline_version: task.deadline_version }),
    overdueRequest, showOverdue: () => setOverdueRequest(v => v + 1), acknowledgeOverdue: () => setOverdueRequest(0) }}>
    {children}<MutationStatus />{editing && <TaskModal key={editing.id} task={editing} onClose={() => setEditing(undefined)} onSave={update} onDelete={remove} />}
  </Context.Provider>;
}
export function useTasks(): TasksState { const value = useContext(Context); if (!value) throw new Error('TasksProvider is required.'); return value; }

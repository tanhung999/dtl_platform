import { useViewMemory, isText, isOffset } from '../../../services/viewMemory';
import { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Task } from '../../../types';
import { useLatestRequest } from '../../../services/useLatestRequest';
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
  query: string; setQuery: (query: string) => void;
  page?: TaskCollection; setOffset: (value: number) => void; setOverdueOffset: (value: number) => void;
  refresh: () => void; edit: (task: Task) => void; openTask: (id: string, signal?: AbortSignal) => Promise<void>;
  create: (payload: TaskInput, attempt: CreateAttempt<TaskInput>) => Promise<void>;
  update: (id: string, payload: Partial<TaskInput> & { is_completed?: boolean }) => Promise<void>;
  toggle: (task: Task) => Promise<void>; remove: (id: string, version?: number) => Promise<void>;
  overdueRequest: number; showOverdue: () => void; acknowledgeOverdue: () => void;
}
const Context = createContext<TasksState | null>(null);
const emptyCounts = { ALL: 0, PENDING: 0, DONE: 0, OVERDUE: 0 };
export function TasksProvider({ children, fullPage = false, collectionEnabled = true }: { children: ReactNode; fullPage?: boolean; collectionEnabled?: boolean }) {
  useWorkspaceRealtime();
  const [page, setPage] = useState<TaskCollection>();
  const view = fullPage ? 'full' : 'widget', limit = fullPage ? 25 : 8;
  const [views, setViews] = useViewMemory<Record<'widget' | 'full', { filter: TaskFilter; offset: number; query: string }>>('tasks', () => ({ widget: { filter: 'ALL', offset: 0, query: '' }, full: { filter: 'ALL', offset: 0, query: '' } }), value => !!value && typeof value === 'object' && ['widget', 'full'].every(name => { const state = (value as any)[name]; return state && ['ALL', 'PENDING', 'DONE', 'OVERDUE'].includes(state.filter) && isOffset(state.offset) && isText(state.query); }));
  const { filter, offset, query } = views[view];
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 300); return () => clearTimeout(timer); }, [query]);
  const search = fullPage ? debounced : '';
  const [overdueOffset, setOverdueOffset] = useState(0);
  const cursors = useRef<Record<string, Record<number, string>>>({}), overdueCursors = useRef<Record<number, string>>({});
  const cursorScope = `${view}/${filter}/${search}`;
  const setOffset = (value: number) => setViews(previous => ({ ...previous, [view]: { ...previous[view], offset: value } }));
  const setQuery = (value: string) => { cursors.current = {}; setViews(previous => ({ ...previous, [view]: { ...previous[view], query: value, offset: 0 } })); };
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busyIds, setBusyIds] = useState<string[]>([]);
  const scope = `${view}/${filter}/${offset}/${overdueOffset}/${limit}/${search}`;
  const [loadedScope, setLoadedScope] = useState('');
  const [editing, setEditing] = useState<Task>(), [now, setNow] = useState(new Date()), [overdueRequest, setOverdueRequest] = useState(0);
  const opening = useLatestRequest();
  const openTask = async (id: string, signal?: AbortSignal) => {
    const controller = opening.start();
    const abort = () => controller.abort();
    if (signal?.aborted) return;
    signal?.addEventListener('abort', abort, { once: true });
    try { const task = await tasksApi.get(id, controller.signal); if (!controller.signal.aborted) setEditing(task); }
    catch (reason) { if (!controller.signal.aborted) throw reason; }
    finally { signal?.removeEventListener('abort', abort); }
  };
  const [revision, refresh] = useInvalidation();
  const busy = useRef(new Set<string>()), mutation = useRef(0);
  const setFilter = (value: TaskFilter) => { cursors.current = {}; setViews(previous => ({ ...previous, [view]: { ...previous[view], filter: value, offset: 0 } })); };
  useEffect(() => {
    if (!collectionEnabled) { setLoading(false); setError(''); return; }
    if (fullPage && query !== debounced) { setLoading(true); return; }
    const controller = new AbortController(), version = mutation.current;
    setLoading(true);
    const anchors = cursors.current[cursorScope] ??= {};
    tasksApi.collection(filter, offset, overdueOffset, controller.signal, anchors[offset], overdueCursors.current[overdueOffset], limit, search).then(value => {
      if (!controller.signal.aborted && version === mutation.current) {
        if (value.next_cursor) anchors[value.offset + value.limit] = value.next_cursor;
        if (value.overdue_next_cursor) overdueCursors.current[value.overdue_offset + 25] = value.overdue_next_cursor;
        setPage(value); setLoadedScope(scope); setError('');
      }
    }).catch(reason => { if (!controller.signal.aborted) {
      if (reason instanceof ApiError && reason.status === 409) { cursors.current = {}; overdueCursors.current = {}; setOffset(0); setOverdueOffset(0); }
      setError(reason.message);
    } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filter, offset, overdueOffset, revision, view, limit, search, query, collectionEnabled]);
  useEffect(() => {
    // Deadlines and form input use minute precision. No whole-workspace rerender every second.
    let timer: ReturnType<typeof setTimeout>, onlineTimer: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(new Date()); timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20); };
    timer = setTimeout(tick, 60000 - Date.now() % 60000 + 20);
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail.includes('tasks')) { cursors.current = {}; overdueCursors.current = {}; refresh(); } };
    const focus = () => { setNow(new Date()); cursors.current = {}; overdueCursors.current = {}; refresh(); };
    const online = () => { clearTimeout(onlineTimer); onlineTimer = setTimeout(focus, Math.random() * 2000); };
    const storage = (event: StorageEvent) => { if (event.key === 'dtl_tasks_changed') refresh(); };
    window.addEventListener(WORKSPACE_CHANGED, changed); window.addEventListener('focus', focus); window.addEventListener('online', online); window.addEventListener('storage', storage);
    return () => { clearTimeout(timer); clearTimeout(onlineTimer); window.removeEventListener(WORKSPACE_CHANGED, changed); window.removeEventListener('focus', focus); window.removeEventListener('online', online); window.removeEventListener('storage', storage); };
  }, [refresh]);
  useEffect(() => {
    if (!collectionEnabled || !page?.next_refresh_at) return;
    const delay = Date.parse(page.next_refresh_at) - Date.parse(page.server_now);
    const timer = setTimeout(() => { setNow(new Date()); refresh(); }, Math.min(2147483647, Math.max(50, delay + 20)));
    return () => clearTimeout(timer);
  }, [page?.next_refresh_at, page?.server_now, refresh, collectionEnabled]);
  const changed = () => { mutation.current++; cursors.current = {}; overdueCursors.current = {}; localStorage.setItem('dtl_tasks_changed', `${Date.now()}:${mutation.current}`); refresh(); };
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
  const currentPage = loadedScope === scope && (!fullPage || query === debounced) ? page : undefined;
  const tasks = useMemo(() => sortTasks(currentPage?.items ?? []), [currentPage?.items]);
  return <Context.Provider value={{ tasks, overdue: page?.overdue ?? [], now, page: currentPage, counts: page?.counts ?? emptyCounts, filter, setFilter, query, setQuery, setOffset, setOverdueOffset,
    revision, loading: collectionEnabled && (fullPage && query !== debounced || (!page || loadedScope !== scope) && (loading || !error)), error, busyIds, refresh, create, update, remove,
    openTask,
    edit: task => { openTask(task.id).catch(reason => setError(reason.message)); },
    toggle: async task => { await mutate(task, { is_completed: !task.is_completed }); },
    overdueRequest, showOverdue: () => setOverdueRequest(v => v + 1), acknowledgeOverdue: () => setOverdueRequest(0) }}>
    {children}<MutationStatus />{editing && <TaskModal key={editing.id} task={editing} onClose={() => { opening.cancel(); setEditing(undefined); }} onSave={update} onDelete={remove} />}
  </Context.Provider>;
}
export function useTasks(): TasksState { const value = useContext(Context); if (!value) throw new Error('TasksProvider is required.'); return value; }

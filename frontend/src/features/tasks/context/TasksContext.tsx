import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Task } from '../../../types';
import { tasksApi } from '../api';
import { TaskInput, TaskReminder } from '../types';
import { isOverdue, sortTasks } from '../deadlineUtils';
import { TaskModal } from '../components/TaskModal';
import '../tasks.css';
import { useWorkspaceRealtime, WORKSPACE_CHANGED } from '../../realtime/useWorkspaceRealtime';

interface TasksState {
  tasks: Task[]; reminders: TaskReminder[]; overdue: Task[]; now: Date;
  loading: boolean; error: string; busyIds: string[];
  refresh: () => void; edit: (task: Task) => void;
  create: (payload: TaskInput) => Promise<void>;
  update: (id: string, payload: Partial<TaskInput> & { is_completed?: boolean }) => Promise<void>;
  setDeadline: (task: Task, date: string | null, time: string | null) => Promise<Task>;
  toggle: (task: Task) => Promise<void>;
  remove: (id: string) => Promise<void>;
  dismiss: (reminder: TaskReminder) => Promise<void>;
  snooze: (reminder: TaskReminder) => Promise<void>;
  overdueRequest: number; showOverdue: () => void; acknowledgeOverdue: () => void;
}
const Context = createContext<TasksState | null>(null);

export function TasksProvider({ children }: { children: ReactNode }) {
  useWorkspaceRealtime();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const [now, setNow] = useState(new Date());
  const [overdueRequest, setOverdueRequest] = useState(0);
  const busy = useRef(new Set<string>());
  const revision = useRef(0);
  const controller = useRef<AbortController>();
  const reminderController = useRef<AbortController>();
  const refreshReminders = useCallback(() => {
    reminderController.current?.abort();
    const current = new AbortController(), version = revision.current;
    reminderController.current = current;
    tasksApi.reminders(current.signal).then(items => {
      if (!current.signal.aborted && revision.current === version) setReminders(items);
    }).catch(reason => { if (!current.signal.aborted) setError(reason.message); });
  }, []);

  const refresh = useCallback(() => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const version = revision.current;
    Promise.all([tasksApi.list(current.signal), tasksApi.reminders(current.signal)])
      .then(([items, notices]) => {
        if (!current.signal.aborted && revision.current === version) { setTasks(items); setReminders(notices); setError(''); }
      }).catch(reason => { if (!current.signal.aborted) setError(reason instanceof Error ? reason.message : 'Không thể tải công việc.'); })
      .finally(() => { if (!current.signal.aborted) setLoading(false); });
  }, []);

  useEffect(() => {
    refresh();
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    const onChange = (event: Event) => {
      const topics = (event as CustomEvent<string[]>).detail;
      if (topics.includes('tasks')) refresh();
      else if (topics.includes('reminders')) refreshReminders();
    };
    const onFocus = () => { setNow(new Date()); refresh(); };
    const onStorage = (event: StorageEvent) => { if (event.key === 'dtl_tasks_changed') refresh(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener(WORKSPACE_CHANGED, onChange);
    return () => { controller.current?.abort(); reminderController.current?.abort(); clearInterval(clock); window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage); window.removeEventListener(WORKSPACE_CHANGED, onChange); };
  }, [refresh, refreshReminders]);

  const changed = () => {
    revision.current += 1;
    setError('');
    localStorage.setItem('dtl_tasks_changed', `${Date.now()}:${revision.current}`);
    refresh();
  };
  const mutate = async (id: string, payload: Partial<TaskInput> & { is_completed?: boolean; expected_deadline_version?: number }) => {
    if (busy.current.has(id)) throw new Error('Công việc đang được cập nhật. Vui lòng thử lại.');
    busy.current.add(id); setBusyIds([...busy.current]);
    try {
      const updated = await tasksApi.update(id, payload);
      setTasks(items => items.map(item => item.id === id ? updated : item));
      changed();
      return updated;
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật công việc.'); throw reason; }
    finally { busy.current.delete(id); setBusyIds([...busy.current]); }
  };
  const update = async (id: string, payload: Partial<TaskInput> & { is_completed?: boolean }) => { await mutate(id, payload); };
  const setDeadline = (task: Task, date: string | null, time: string | null) => mutate(task.id, { due_date: date, due_time: time, expected_deadline_version: task.deadline_version });
  const create = async (payload: TaskInput) => {
    const created = await tasksApi.create(payload);
    setTasks(items => [...items, created]); changed();
  };
  const remove = async (id: string) => {
    await tasksApi.remove(id); setTasks(items => items.filter(item => item.id !== id)); changed();
  };
  const dismiss = async (reminder: TaskReminder) => {
    await tasksApi.dismiss(reminder);
    setReminders(items => items.filter(item => !(item.task_id === reminder.task_id && item.kind === reminder.kind && item.deadline_version === reminder.deadline_version)));
    changed();
  };
  const snooze = async (reminder: TaskReminder) => {
    await tasksApi.snooze(reminder);
    setReminders(items => items.filter(item => item.task_id !== reminder.task_id));
    changed();
  };
  const editing = tasks.find(task => task.id === editingId);
  const sorted = sortTasks(tasks);
  const liveReminders = reminders.filter(reminder => tasks.some(task => task.id === reminder.task_id && !task.is_completed && !isOverdue(task, now) && task.deadline_version === reminder.deadline_version));
  return <Context.Provider value={{ tasks: sorted, overdue: sorted.filter(task => isOverdue(task, now)), now, reminders: liveReminders, loading, error, busyIds,
    refresh, create, update, setDeadline, remove, toggle: task => update(task.id, { is_completed: !task.is_completed }), edit: task => setEditingId(task.id), dismiss, snooze,
    overdueRequest, showOverdue: () => setOverdueRequest(value => value + 1), acknowledgeOverdue: () => setOverdueRequest(0) }}>
    {children}
    {editing && <TaskModal key={editing.id} task={editing} onClose={() => setEditingId(undefined)} onSave={update} onDelete={remove} />}
  </Context.Provider>;
}

export function useTasks(): TasksState {
  const value = useContext(Context);
  if (!value) throw new Error('TasksProvider is required.');
  return value;
}

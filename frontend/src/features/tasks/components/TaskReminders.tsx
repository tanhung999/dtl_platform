import { Bell, ChevronDown, ChevronUp, Clock3, Info, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTasks } from '../context/TasksContext';
import { vietnamDay } from '../deadlineUtils';
import { upcomingReminders, reminderDayLabel } from '../reminderUtils';
import { TaskReminder } from '../types';

const HELP = 'Nhắc từ 08:00 ngày trước và ngày đến hạn; hạn sớm nhắc trước 30 phút. Ẩn nhắc không đánh dấu hoàn thành. Nhắc lại sau 1 giờ áp dụng khi việc chưa quá hạn; việc trễ chuyển vào nhóm Quá hạn.';

export function TaskReminders({ onOpenOverdue }: { onOpenOverdue: () => void }) {
  const data = useTasks();
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const helpPanel = useRef<HTMLParagraphElement>(null);
  const helpButton = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const helpId = useId();
  useEffect(() => {
    if (!showHelp) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!helpPanel.current?.contains(target) && !helpButton.current?.contains(target)) setShowHelp(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setShowHelp(false); helpButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [showHelp]);
  const reminders = upcomingReminders(data.reminders, data.tasks, data.now);
  const today = vietnamDay(data.now);
  const todayCount = reminders.filter(reminder => reminder.due_date === today).length;
  const tomorrowCount = reminders.length - todayCount;
  const summary = [todayCount ? `${todayCount} đến hạn hôm nay` : '', tomorrowCount ? `${tomorrowCount} đến hạn ngày mai` : ''].filter(Boolean).join(' · ');
  const limit = data.overdue.length ? 3 : 4;
  const visible = showAll ? reminders : reminders.slice(0, limit);
  const act = async (reminder: TaskReminder, action: 'dismiss' | 'snooze') => {
    const key = reminder.task_id;
    if (busy.includes(key)) return;
    setBusy(items => [...items, key]); setError('');
    try { await data[action](reminder); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Không thể cập nhật nhắc hạn.'); }
    finally { setBusy(items => items.filter(item => item !== key)); }
  };
  const openOverdue = () => { onOpenOverdue(); data.showOverdue(); };
  if (!reminders.length && !data.overdue.length && !error) return null;
  return <section className="task-reminders" aria-label="Nhắc hạn công việc">
    <div className="task-reminders-heading">
      <div className="task-reminders-title"><Bell size={19} /><div><strong>Nhắc hạn</strong>{summary && <p className="task-reminders-summary" aria-live="polite">{summary}</p>}</div></div>
      <div className="task-reminders-actions">
        <button ref={helpButton} type="button" className="task-icon-button" title="Quy tắc nhắc hạn" aria-label="Quy tắc nhắc hạn" aria-expanded={showHelp} aria-controls={helpId} onClick={() => setShowHelp(value => !value)}><Info size={17} /></button>
        <button type="button" className="task-icon-button" title={collapsed ? 'Mở nhắc hạn' : 'Thu gọn nhắc hạn'} aria-label={collapsed ? 'Mở nhắc hạn' : 'Thu gọn nhắc hạn'} aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed(value => !value)}>{collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>
      </div>
    </div>
    {showHelp && <p ref={helpPanel} id={helpId} className="task-reminders-help">{HELP}</p>}
    {error && <p role="alert" className="alert-error">{error}</p>}
    <div id={listId} hidden={collapsed}>
      <div className="task-reminders-list">
        {data.overdue.length > 0 && <button type="button" className="task-reminder-overdue" title="Mở nhóm quá hạn trong To-Do" onClick={openOverdue}><strong>{data.overdue.length} việc quá hạn</strong><span>Xem trong To-Do →</span></button>}
        {visible.map(reminder => <div data-reminder-id={reminder.task_id} key={`${reminder.task_id}:${reminder.deadline_version}:${reminder.kind}`} className={`task-reminder ${reminder.due_date === today ? 'is-today' : 'is-tomorrow'}`}>
          <button type="button" className="task-reminder-open" title={reminder.title} onClick={() => { const task = data.tasks.find(item => item.id === reminder.task_id); if (task) data.edit(task); }}><strong>{reminder.title}</strong><span>{reminderDayLabel(reminder, data.now)}{reminder.due_date !== today && <span className="task-reminder-stage"> · Sắp đến hạn</span>}</span></button>
          <div className="task-reminder-actions">
            <button type="button" className="task-icon-button" title="Nhắc lại sau 1 giờ" aria-label={`Nhắc lại sau 1 giờ: ${reminder.title}`} disabled={busy.includes(reminder.task_id)} onClick={() => { void act(reminder, 'snooze'); }}><Clock3 size={16} /></button>
            <button type="button" className="task-icon-button" title="Ẩn nhắc này" aria-label={`Ẩn nhắc này: ${reminder.title}`} disabled={busy.includes(reminder.task_id)} onClick={() => { void act(reminder, 'dismiss'); }}><X size={16} /></button>
          </div>
        </div>)}
      </div>
      {reminders.length > limit && <button type="button" className="task-reminders-more" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Hiện ít hơn' : `+${reminders.length - limit} việc nữa`}</button>}
    </div>
  </section>;
}

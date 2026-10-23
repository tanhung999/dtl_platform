import { Bell, CheckCheck, Clock3, EyeOff, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useNotifications } from './NotificationsProvider';
import { NotificationItem, SOURCE_LABELS } from './types';
const STATE_LABELS = { changed: 'Lịch thông báo đã thay đổi', ended: 'Đã kết thúc', archived: 'Đã lưu trữ', completed: 'Đã hoàn thành', deleted: 'Đã xóa', overdue: 'Quá hạn', active: '' };
export function NotificationCard({ item, onOpened }: { item: NotificationItem; onOpened?: () => void }) {
  const data = useNotifications(), [error, setError] = useState('');
  const busy = data.busyIds.includes(item.id) || data.busyIds.includes('all');
  const action = async (callback: () => Promise<void>) => { setError(''); try { await callback(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Không cập nhật được thông báo.'); } };
  const sourceLabel = item.source === 'platform' ? item.ownership_label : SOURCE_LABELS[item.source];
  const canSnooze = !item.calendar_owner_id && item.resource_type === 'task' && ['task.reminder', 'task.snooze'].includes(item.kind) && item.state === 'active' && !item.snoozed_until && item.due_at && Date.parse(item.due_at) > Date.now() + 3600000 && !item.dismissed_at;
  return <article className={`notification-card ${item.read_at ? 'is-read' : 'is-unread'} ${item.kind === 'task.overdue' ? 'is-overdue' : ''}`} data-notification-id={item.id}>
    <div className="notification-card-main"><Bell size={16} aria-hidden="true" /><div>
      <button type="button" className="notification-open" disabled={busy} title={item.title} onClick={() => { void action(async () => { await data.open(item); onOpened?.(); }); }}>{item.title}</button>
      <p>{item.body}</p><div className="notification-meta">{sourceLabel && <span>{sourceLabel}</span>}<time dateTime={item.created_at} title={new Date(item.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}>{new Date(item.created_at).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</time>
        {STATE_LABELS[item.state] && <span className={`notification-state is-${item.state}`}>{STATE_LABELS[item.state]}</span>}
        {item.snoozed_until && <span>Đã hẹn thông báo lại</span>}
      </div>
    </div></div>
    <div className="notification-card-actions">
      <button type="button" disabled={busy} title={item.read_at ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'} aria-label={`${item.read_at ? 'Đánh dấu chưa đọc' : 'Đánh dấu đã đọc'}: ${item.title}`} onClick={() => { void action(() => data.state(item, { read: !item.read_at })); }}><CheckCheck size={16} /></button>
      {canSnooze && <button type="button" disabled={busy} title="Thông báo lại sau 1 giờ" aria-label={`Thông báo lại sau 1 giờ: ${item.title}`} onClick={() => { void action(() => data.snooze(item)); }}><Clock3 size={16} /></button>}
      <button type="button" disabled={busy} title={item.dismissed_at ? 'Khôi phục thông báo' : 'Ẩn thông báo'} aria-label={`${item.dismissed_at ? 'Khôi phục thông báo' : 'Ẩn thông báo'}: ${item.title}`} onClick={() => { void action(() => data.state(item, { dismissed: !item.dismissed_at })); }}>{item.dismissed_at ? <RotateCcw size={16} /> : <EyeOff size={16} />}</button>
    </div>
    {error && <p className="notification-action-error" role="alert">{error}</p>}
  </article>;
}

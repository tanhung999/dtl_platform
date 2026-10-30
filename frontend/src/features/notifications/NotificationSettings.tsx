import { useEffect, useState } from 'react';
import { notificationsApi } from './api';
import { NotificationPreferences } from './types';
import { useNotifications } from './NotificationsProvider';
export function NotificationSettings() {
  const { refresh, revision } = useNotifications();
  const [data, setData] = useState<NotificationPreferences>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    notificationsApi.preferences(controller.signal).then(value => { if (!controller.signal.aborted) { setData(value); setError(''); } }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [revision]);
  const options = [{ key: 'task_reminders', label: 'Thông báo lịch, công việc và ghi chú do tôi tạo' }, { key: 'bookingreports', label: 'DT Booking 360' }, { key: 'workflows', label: 'DT Workflow' }, { key: 'itam', label: 'DT Assets' }] as const;
  return <section className="notification-settings" aria-label="Cài đặt thông báo"><h2>Nhận thông báo</h2><p>Tắt nhận thông báo không xóa lịch sử đã có. Thông báo xuất hiện trong website khi bạn truy cập; hiện chưa gửi qua email hoặc thông báo đẩy khi đóng trình duyệt.</p>
    {error && <p role="alert">{error}<button type="button" onClick={refresh}>Thử lại</button></p>}
    {!data ? <p>Đang tải cài đặt…</p> : options.map(option => <label key={option.key}><input type="checkbox" disabled={busy} checked={data[option.key]} onChange={async event => {
      setBusy(true); setError('');
      try { setData(await notificationsApi.savePreferences({ [option.key]: event.target.checked, expected_version: data.version })); refresh(); }
      catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); }
    }} /><span>{option.label}</span>{option.key !== 'task_reminders' && !data.connected[option.key] && <small>Chưa kết nối</small>}</label>)}
  </section>;
}

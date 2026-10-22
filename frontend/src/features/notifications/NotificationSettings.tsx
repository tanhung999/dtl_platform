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
  const options = [{ key: 'task_reminders', label: 'Nhắc hạn từ lịch của bạn và lịch được chia sẻ' }, { key: 'bookingreports', label: 'Income Statement' }, { key: 'workflows', label: 'Workflows' }, { key: 'itam', label: 'Quản lý tài sản' }] as const;
  return <section className="notification-settings" aria-label="Cài đặt thông báo"><h2>Nhận thông báo</h2><p>Tắt nhận không xóa lịch sử. Thông báo hiển thị trong website, chưa gửi qua email hoặc thông báo đẩy.</p>
    {error && <p role="alert">{error}<button type="button" onClick={refresh}>Thử lại</button></p>}
    {!data ? <p>Đang tải cài đặt…</p> : options.map(option => <label key={option.key}><input type="checkbox" disabled={busy} checked={data[option.key]} onChange={async event => {
      setBusy(true); setError('');
      try { setData(await notificationsApi.savePreferences({ [option.key]: event.target.checked, expected_version: data.version })); refresh(); }
      catch (reason) { setError((reason as Error).message); }
      finally { setBusy(false); }
    }} /><span>{option.label}</span>{option.key !== 'task_reminders' && !data.connected[option.key] && <small>Chưa kết nối</small>}</label>)}
  </section>;
}

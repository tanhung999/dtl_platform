import { useState } from 'react';
import { Bell, Settings2 } from 'lucide-react';
import { useNotifications } from './NotificationsProvider';
import { useNotificationFeed } from './useNotificationFeed';
import { NotificationCard } from './NotificationCard';
import { NotificationSettings } from './NotificationSettings';
import { NotificationSource, SOURCE_LABELS } from './types';
export function NotificationsPage() {
  const data = useNotifications(), feed = useNotificationFeed();
  const [settings, setSettings] = useState(false), [error, setError] = useState('');
  let previousDay = '';
  const today = new Date().toLocaleDateString('vi-VN');
  return <section className="notifications-page"><header className="notifications-page-heading"><div><Bell size={26} /><h1>Thông báo</h1><span>{data.summary?.unread_count ?? 0} chưa đọc</span></div><button type="button" className="btn btn-outline btn-sm" aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings2 size={16} />Cài đặt</button></header>
    {settings && <NotificationSettings />}
    <div className="notification-toolbar"><div className="notification-filters">{([{ id: 'all', label: 'Tất cả' }, { id: 'unread', label: 'Chưa đọc' }, { id: 'hidden', label: 'Đã ẩn' }] as const).map(option => <button key={option.id} type="button" aria-pressed={feed.filter === option.id} onClick={() => feed.setFilter(option.id)}>{option.label}</button>)}</div>
      <label className="notification-source-filter">Nguồn<select aria-label="Nguồn" value={feed.source} onChange={event => feed.setSource(event.target.value as NotificationSource | '')}><option value="">Tất cả nguồn</option>{Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <button type="button" className="notification-text-button" disabled={!data.summary?.unread_count || data.busyIds.includes('all')} onClick={async () => { setError(''); try { await data.readAll(); } catch (reason) { setError((reason as Error).message); } }}>Đánh dấu tất cả đã đọc</button>
      {feed.index > 0 && <button type="button" className="notification-text-button" onClick={feed.newest}>Xem mới nhất</button>}
    </div>
    {(feed.error || data.error || error) && <p role="alert" className="notification-error">{feed.error || data.error || error}<button type="button" onClick={data.refresh}>Thử lại</button></p>}
    <div className="notifications-feed">{feed.loading ? <p className="notification-empty">Đang tải thông báo…</p> : !feed.page?.items.length ? <p className="notification-empty">Không có thông báo trong nhóm này.</p> : feed.page.items.map(item => {
      const day = new Date(item.created_at).toLocaleDateString('vi-VN'), heading = previousDay !== day; previousDay = day;
      return <div key={item.id}>{heading && <h2 className="notification-day-heading">{day === today ? 'Hôm nay' : day}</h2>}<NotificationCard item={item} /></div>;
    })}</div>
    <footer className="notification-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={feed.pending || feed.index === 0} onClick={feed.previous}>Trang trước</button><span>Trang {feed.index + 1}</span><button type="button" className="btn btn-outline btn-sm" disabled={feed.pending || !feed.page?.has_more} onClick={feed.next}>Trang sau</button></footer>
  </section>;
}

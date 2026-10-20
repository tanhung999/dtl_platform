import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X } from 'lucide-react';
import { useNotifications } from './NotificationsProvider';
import { useNotificationFeed } from './useNotificationFeed';
import { NotificationCard } from './NotificationCard';
export const NotificationBell = memo(function NotificationBell({ onOpenAll }: { onOpenAll: () => void }) {
  const data = useNotifications(), [open, setOpen] = useState(false), [error, setError] = useState('');
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const feed = useNotificationFeed(open);
  const [position, setPosition] = useState({ top: 84, right: 20 });
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = button.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(440, window.innerWidth - 24);
        setPosition({ top: Math.max(12, Math.min(rect.bottom + 10, window.innerHeight - 180)),
          right: Math.max(12, Math.min(window.innerWidth - width - 12, window.innerWidth - rect.right)) });
      }
    };
    place(); panel.current?.focus();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  const count = data.summary?.unread_count ?? 0;
  return <><button type="button" ref={button} className="notification-bell" aria-label={`Thông báo${count ? `, ${count} chưa đọc` : ''}`} aria-expanded={open} onClick={() => setOpen(true)}><Bell size={20} />{count > 0 && <span className="notification-unread-count">{count > 99 ? '99+' : count}</span>}</button>
    {open && createPortal(<div ref={panel} className="notification-popover" style={position} role="dialog" aria-label="Thông báo" tabIndex={-1}>
      <header><h2>Thông báo</h2><button type="button" className="notification-icon" aria-label="Đóng thông báo" onClick={() => setOpen(false)}><X size={18} /></button></header>
      <div className="notification-toolbar"><div className="notification-filters">{(['all', 'unread'] as const).map(filter => <button key={filter} type="button" aria-pressed={feed.filter === filter} onClick={() => feed.setFilter(filter)}>{filter === 'all' ? 'Tất cả' : 'Chưa đọc'}</button>)}</div><button type="button" className="notification-text-button" disabled={!count || data.busyIds.includes('all')} onClick={async () => { setError(''); try { await data.readAll(); } catch (reason) { setError((reason as Error).message); } }}>Đánh dấu tất cả đã đọc</button></div>
      {(feed.error || data.error || error) && <p role="alert" className="notification-error">{feed.error || data.error || error}<button type="button" onClick={data.refresh}>Thử lại</button></p>}
      <div className="notification-popover-list">{feed.loading ? <p className="notification-empty">Đang tải thông báo…</p> : feed.page?.items.length ? feed.page.items.map(item => <NotificationCard key={item.id} item={item} onOpened={() => setOpen(false)} />) : <p className="notification-empty">{feed.filter === 'unread' ? 'Bạn đã đọc hết thông báo.' : 'Chưa có thông báo.'}</p>}</div>
      <button type="button" className="notification-view-all" onClick={() => { setOpen(false); onOpenAll(); }}>Xem tất cả thông báo</button>
    </div>, document.body)}
  </>;
});

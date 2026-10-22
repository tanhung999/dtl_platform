import { NotificationBell } from '../features/notifications/NotificationBell';
import { LogOut, Search } from 'lucide-react';
import brandLogo from '../assets/logo.png';
import { User } from '../types';
import { NavbarClock } from './NavbarClock';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  user: User; onOpenProfile: () => void; onLogout: () => void; onOpenNotifications: () => void;
  query: string; onSearch: (query: string) => void;
}

export function Navbar({ user, onOpenProfile, onLogout, onOpenNotifications, query, onSearch }: NavbarProps) {
  const names = user.full_name.trim().split(/\s+/);
  const initials = (names[0]?.[0] || '') + (names.length > 1 ? names[names.length - 1][0] : '');
  return <header className="platform-navbar">
    <div className="nav-brand"><span className="nav-brand-mark"><img src={brandLogo} alt="Đông Tây One" className="nav-brand-logo" /></span>
      <div className="nav-brand-text"><strong className="nav-brand-name">ĐÔNG TÂY ONE</strong><span>Everything In One Place</span></div>
    </div>
    <label className="workspace-search"><Search size={19} aria-hidden="true" />
      <input type="search" aria-label="Tìm kiếm toàn hệ thống" placeholder="Tìm ứng dụng, công việc, ghi chú, sự kiện…" value={query} maxLength={200} onChange={event => onSearch(event.target.value)} />
    </label>
    <div className="nav-actions"><NavbarClock /><ThemeToggle /><NotificationBell onOpenAll={onOpenNotifications} />
      <button type="button" className="user-badge" onClick={onOpenProfile} title="Xem hồ sơ tài khoản" aria-label={`Hồ sơ của ${user.full_name}`}>
        <span className="user-avatar"><span>{initials.toUpperCase()}</span>{user.avatar_url && <img key={user.avatar_url} src={user.avatar_url} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />}</span>
        <span className="user-info"><span className="user-name">{user.full_name}</span><span className="user-dept">{user.department}</span></span>
      </button>
      <button type="button" onClick={onLogout} className="btn btn-outline btn-sm workspace-logout" title="Đăng xuất" aria-label="Đăng xuất"><LogOut size={17} /></button>
    </div>
  </header>;
}

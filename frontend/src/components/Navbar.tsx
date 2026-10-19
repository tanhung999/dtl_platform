import { NotificationBell } from '../features/notifications/NotificationBell';
import React from 'react';
import { LogOut, User as UserIcon, UserCheck, ShieldCheck, CalendarDays } from 'lucide-react';
import { FeatureIcon } from './FeatureIcon';
import brandLogo from '../assets/logo.jpg';
import { User } from '../types';
import { NavbarClock } from './NavbarClock';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  user: User;
  activeTab: 'dashboard' | 'profile' | 'calendar' | 'notifications' | 'admin';
  onTabChange: (tab: 'dashboard' | 'profile' | 'calendar' | 'admin') => void;
  canManage: boolean;
  onLogout: () => void;
  onOpenNotifications: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, activeTab, onTabChange, onLogout, onOpenNotifications, canManage }) => {
  return (
    <header className="platform-navbar">
      <div className="nav-brand">
        <img src={brandLogo} alt="Đông Tây One" className="nav-brand-logo" />
        <div className="nav-brand-text">
          <h1>ĐÔNG TÂY ONE</h1>
          <span>Everything. In One Place</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="nav-tabs-pill">
        <button
          type="button"
          onClick={() => onTabChange('dashboard')}
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <FeatureIcon name="platform" size={22} />
          <span>Workspace</span>
        </button>

        <button type="button" onClick={() => onTabChange('calendar')}
          className={`nav-tab-btn ${activeTab === 'calendar' ? 'active' : ''}`}>
          <CalendarDays size={15} />
          <span>Lịch</span>
        </button>

        <button
          type="button"
          onClick={() => onTabChange('profile')}
          className={`nav-tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
        >
          <UserCheck size={15} />
          <span>Profile</span>
        </button>
        {canManage && <button type="button" onClick={() => onTabChange('admin')}
          className={`nav-tab-btn ${activeTab === 'admin' ? 'active' : ''}`}>
          <ShieldCheck size={15} /><span>Quản trị</span>
        </button>}
      </nav>

      <div className="nav-actions">
        {/* Clock */}
        <NavbarClock />

        {/* Dark/Light Theme Toggle */}
        <ThemeToggle />
        <NotificationBell onOpenAll={onOpenNotifications} />

        {/* User Badge */}
        <div
          className={`user-badge ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => onTabChange('profile')}
          title="Xem thông tin chi tiết tài khoản"
        >
          <div className="user-avatar">
            {user.full_name ? user.full_name.charAt(0).toUpperCase() : <UserIcon size={14} />}
          </div>
          <div className="user-info">
            <span className="user-name">{user.full_name}</span>
            <span className="user-dept">{user.department}</span>
          </div>
        </div>

        <button
          onClick={onLogout}
          className="btn btn-outline btn-sm"
          title="Đăng xuất khỏi Platform"
        >
          <LogOut size={14} />
          <span>Đăng xuất</span>
        </button>
      </div>
    </header>
  );
};

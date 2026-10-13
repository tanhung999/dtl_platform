import React, { useEffect, useState } from 'react';
import { LogOut, User as UserIcon, Clock, LayoutDashboard, UserCheck, CalendarDays } from 'lucide-react';
import { User } from '../types';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  user: User;
  activeTab: 'dashboard' | 'profile' | 'calendar';
  onTabChange: (tab: 'dashboard' | 'profile' | 'calendar') => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, activeTab, onTabChange, onLogout }) => {
  const [timeStr, setTimeStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('vi-VN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="platform-navbar">
      <div className="nav-brand">
        <img src="/logo.png" alt="Đông Tây Land" className="nav-brand-logo" />
        <div className="nav-brand-text">
          <h1>ĐÔNG TÂY LAND</h1>
          <span>Digital Workplace & SSO Platform</span>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="nav-tabs-pill">
        <button
          type="button"
          onClick={() => onTabChange('dashboard')}
          className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
        >
          <LayoutDashboard size={15} />
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
      </nav>

      <div className="nav-actions">
        {/* Clock */}
        <div className="nav-clock">
          <Clock size={15} />
          <span style={{ fontWeight: 600 }}>{timeStr}</span>
        </div>

        {/* Dark/Light Theme Toggle */}
        <ThemeToggle />

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

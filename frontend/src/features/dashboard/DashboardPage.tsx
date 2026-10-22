import { SearchPage } from '../search/SearchPage';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { WorkspacePage } from './navigation';
import { NotesPage } from '../notes/NotesPage';
import { RescheduleToast } from '../rescheduling/RescheduleToast';
import { TasksPage } from '../tasks/TasksPage';
import { SharingCapabilityContext } from '../access/SharingCapabilityContext';
import { WorkspaceWidgets } from './WorkspaceWidgets';
import React, { useEffect, useState } from 'react';
import { AdminPage } from '../admin/AdminPage';
import { useAccessCapabilities } from '../access/useAccessCapabilities';
import { Navbar } from '../../components/Navbar';
import { ProfileTab } from '../profile/ProfileTab';
import { CalendarWorkspace } from '../calendar-sharing/CalendarWorkspace';
import { User } from '../../types';
import { TasksProvider } from '../tasks/context/TasksContext';
import { NotificationsProvider } from '../notifications/NotificationsProvider';
import { NotificationsPage } from '../notifications/NotificationsPage';

interface DashboardPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onUserUpdated, onLogout }) => {
  const [activeTab, setActiveTab] = useState<WorkspacePage>('dashboard');
  const access = useAccessCapabilities(user.id);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('dtl_sidebar_collapsed') === 'true'; } catch { return false; } });
  const navigate = (page: WorkspacePage) => { setSearchQuery(''); if (page === 'calendar') { setSharedOwner(undefined); setCalendarDate(undefined); } setActiveTab(page); };
  const toggleSidebar = () => setCollapsed(previous => { const value = !previous; try { localStorage.setItem('dtl_sidebar_collapsed', String(value)); } catch { /* Layout persistence is optional. */ } return value; });
  const [sharedOwner, setSharedOwner] = useState<string>();
  const [calendarDate, setCalendarDate] = useState<Date>();
  useEffect(() => { const open = (event: Event) => { setSharedOwner((event as CustomEvent<string>).detail); setActiveTab('calendar'); }; window.addEventListener('calendar:open-shared', open); return () => window.removeEventListener('calendar:open-shared', open); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  return (
    <SharingCapabilityContext.Provider value={access.can_share && !access.loading && !access.error}><TasksProvider key={user.id} fullPage={activeTab === 'tasks'}><NotificationsProvider userId={user.id}><div className={`dashboard-app${collapsed ? ' sidebar-is-collapsed' : ''}`}>
      <RescheduleToast />
      <Navbar user={user} query={searchQuery} onSearch={query => { setSearchQuery(query); setActiveTab(query.trim() ? 'search' : 'dashboard'); }}
        onOpenProfile={() => navigate('profile')} onOpenNotifications={() => navigate('notifications')} onLogout={onLogout} />
      <div className="workspace-shell">
        <WorkspaceSidebar page={activeTab} onNavigate={navigate} canManage={access.can_manage} collapsed={collapsed} onToggle={toggleSidebar} />
        <div className="workspace-content"><main className="workspace-main" id="workspace-main">
        {activeTab === 'search' ? <SearchPage query={searchQuery} user={user} /> : activeTab === 'dashboard' ? (
          <WorkspaceWidgets user={user} onOpenApps={() => navigate('apps')} onOpenTasks={() => navigate('tasks')} onOpenNotes={() => navigate('notes')}
            onOpenCalendar={date => { setSharedOwner(undefined); setCalendarDate(date); setActiveTab('calendar'); }} />
        ) : activeTab === 'tasks' ? <TasksPage onBack={() => navigate('dashboard')} />
          : activeTab === 'notes' ? <NotesPage initialFilter="all" onBack={() => navigate('dashboard')} />
          : activeTab === 'apps' ? <section className="workspace-section-page" aria-label="Ứng dụng doanh nghiệp"><AppLauncherWidget allowedApps={user.allowed_apps ?? ''} detailed /></section>
          : activeTab === 'bookmarks' ? <section className="workspace-section-page" aria-label="Quản lý liên kết nhanh"><BookmarksWidget /></section>
          : activeTab === 'calendar' ? (
          <CalendarWorkspace key={`${user.id}:${sharedOwner ?? "mine"}`} initialOwner={sharedOwner} initialDate={calendarDate} userName={user.full_name} userId={user.id} />
        ) : activeTab === 'notifications' ? <NotificationsPage /> : activeTab === 'admin' ? (
          <AdminPage revision={access.revision} allowed={access.can_manage} loading={access.loading} error={access.error} onChanged={access.refresh} />
        ) : (
          <ProfileTab user={user} onUserUpdated={onUserUpdated} canManage={access.can_manage && !access.loading && !access.error} />
        )}
      </main>

      <footer className="platform-footer">
        <div>
          Designed by <strong>Phòng CN & CĐS - Đông Tây Land</strong>
        </div>
        <div style={{ fontSize: '0.725rem', color: 'var(--text-sub)' }}>
          v 1.0.0
        </div>
      </footer></div></div>
    </div></NotificationsProvider></TasksProvider></SharingCapabilityContext.Provider>
  );
};

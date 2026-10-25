import { pageForPath, workspaceRoutes } from './navigation';
import { RescheduleToast } from '../rescheduling/RescheduleToast';
import { SharingCapabilityContext } from '../access/SharingCapabilityContext';
import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { PageLoading, PageLoadBoundary } from '../../components/PageLoading';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAccessCapabilities } from '../access/useAccessCapabilities';
import { Navbar } from '../../components/Navbar';
import { PageBranding } from '../../components/PageBranding';
import { User } from '../../types';
import { TasksProvider } from '../tasks/context/TasksContext';
import { NotificationsProvider } from '../notifications/NotificationsProvider';
import { dateKey, parseDate } from '../calendar/dateUtils';
import { isDay } from '../../services/viewMemory';
import './dashboard.css';

const SearchPage = lazy(() => import('../search/SearchPage').then(module => ({ default: module.SearchPage })));
const AppLauncherWidget = lazy(() => import('../apps/AppLauncherWidget').then(module => ({ default: module.AppLauncherWidget })));
const NotesPage = lazy(() => import('../notes/NotesPage').then(module => ({ default: module.NotesPage })));
const TasksPage = lazy(() => import('../tasks/TasksPage').then(module => ({ default: module.TasksPage })));
const WorkspaceWidgets = lazy(() => import('./WorkspaceWidgets').then(module => ({ default: module.WorkspaceWidgets })));
const AdminPage = lazy(() => import('../admin/AdminPage').then(module => ({ default: module.AdminPage })));
const ProfileTab = lazy(() => import('../profile/ProfileTab').then(module => ({ default: module.ProfileTab })));
const CalendarWorkspace = lazy(() => import('../calendar-sharing/CalendarWorkspace').then(module => ({ default: module.CalendarWorkspace })));
const NotificationsPage = lazy(() => import('../notifications/NotificationsPage').then(module => ({ default: module.NotificationsPage })));

interface DashboardPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onUserUpdated, onLogout }) => {
  const location = useLocation(), navigate = useNavigate();
  const activeTab = pageForPath(location.pathname);
  const access = useAccessCapabilities(user.id);
  const params = new URLSearchParams(location.search);
  const searchQuery = activeTab === 'search' ? params.get('q') ?? '' : '';
  const sharedOwner = params.get('owner')?.trim() || undefined;
  const day = params.get('date');
  const calendarDate = useMemo(() => isDay(day) ? parseDate(day!) : undefined, [day]);
  const linkRequest = typeof location.state?.linkRequest === 'string' ? location.state.linkRequest : undefined;
  const openCalendar = (date: Date) => navigate(`${workspaceRoutes.calendar.path}?${new URLSearchParams({ date: dateKey(date) })}`);
  const changeCalendarDate = (date: Date) => {
    const query = new URLSearchParams(location.search);
    query.set('date', dateKey(date));
    navigate(`${workspaceRoutes.calendar.path}?${query}`, { replace: true });
  };
  const changeCalendarOwner = (owner?: string) => {
    const query = new URLSearchParams(location.search);
    if (owner) query.set('owner', owner); else query.delete('owner');
    navigate(workspaceRoutes.calendar.path + (query.size ? `?${query}` : ''));
  };
  const search = (query: string) => navigate(query.trim() ? `${workspaceRoutes.search.path}?${new URLSearchParams({ q: query })}` : workspaceRoutes.dashboard.path, { replace: activeTab === 'search' });
  useEffect(() => {
    const open = (event: Event) => {
      const owner = (event as CustomEvent<unknown>).detail;
      if (typeof owner === 'string' && owner.trim()) navigate(`${workspaceRoutes.calendar.path}?${new URLSearchParams({ owner })}`);
    };
    window.addEventListener('calendar:open-shared', open);
    return () => window.removeEventListener('calendar:open-shared', open);
  }, [navigate]);
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);

  return (
    <SharingCapabilityContext.Provider value={access.can_share && !access.loading && !access.error}><TasksProvider key={user.id} fullPage={activeTab === 'tasks'} collectionEnabled={activeTab === 'dashboard' || activeTab === 'tasks' || activeTab === 'calendar'}><NotificationsProvider userId={user.id}><div className={`dashboard-app${activeTab === 'calendar' ? ' calendar-is-active' : ''}`}>
      <PageBranding page={activeTab} notFound={!activeTab && location.pathname !== '/'} />
      <RescheduleToast />
      <Navbar canManage={access.can_manage && !access.loading && !access.error} user={user} query={searchQuery} onSearch={search}
        onOpenProfile={() => navigate(workspaceRoutes.profile.path)} onOpenNotifications={() => navigate(workspaceRoutes.notifications.path)} onLogout={onLogout} />
      <div className="workspace-shell">
        <div className="workspace-content"><main className="workspace-main" id="workspace-main">
          <PageLoadBoundary key={location.pathname}><Suspense fallback={<PageLoading />}><Routes>
            <Route path="/" element={<Navigate to={workspaceRoutes.dashboard.path} replace />} />
            <Route path={workspaceRoutes.dashboard.path} element={<WorkspaceWidgets user={user} linkRequest={linkRequest}
              onOpenApps={() => navigate(workspaceRoutes.apps.path)} onOpenTasks={() => navigate(workspaceRoutes.tasks.path)} onOpenNotes={() => navigate(workspaceRoutes.notes.path)} onOpenCalendar={openCalendar} />} />
            <Route path={workspaceRoutes.apps.path} element={<section className="workspace-section-page" aria-label="Ứng dụng doanh nghiệp"><AppLauncherWidget detailed /></section>} />
            <Route path={workspaceRoutes.tasks.path} element={<TasksPage />} />
            <Route path={workspaceRoutes.notes.path} element={<NotesPage initialFilter="all" />} />
            <Route path={workspaceRoutes.calendar.path} element={<CalendarWorkspace key={`${user.id}:${sharedOwner ?? 'mine'}`} initialOwner={sharedOwner} initialDate={calendarDate} onDateChange={changeCalendarDate} onOwnerChange={changeCalendarOwner} userName={user.full_name} userId={user.id} />} />
            <Route path={workspaceRoutes.profile.path} element={<ProfileTab user={user} onUserUpdated={onUserUpdated} canManage={access.can_manage && !access.loading && !access.error} />} />
            <Route path={workspaceRoutes.notifications.path} element={<NotificationsPage />} />
            <Route path={workspaceRoutes.admin.path} element={<AdminPage revision={access.revision} allowed={access.can_manage} loading={access.loading} error={access.error} onChanged={access.refresh} />} />
            <Route path={workspaceRoutes.search.path} element={<SearchPage query={searchQuery} user={user} />} />
            <Route path="*" element={<section className="workspace-section-page workspace-not-found" aria-labelledby="not-found-title"><h1 id="not-found-title">Không tìm thấy trang</h1><p>Đường dẫn này không tồn tại. Bạn có thể trở về trang chủ.</p><Link className="btn btn-primary" to={workspaceRoutes.dashboard.path}>Về trang chủ</Link></section>} />
          </Routes></Suspense></PageLoadBoundary>
        </main>
        <footer className="platform-footer">
          <div>Designed by <strong>Phòng CN & CĐS - Đông Tây Land</strong></div>
          <div style={{ fontSize: '0.725rem', color: 'var(--text-sub)' }}>v 1.0.0</div>
        </footer></div>
      </div>
    </div></NotificationsProvider></TasksProvider></SharingCapabilityContext.Provider>
  );
};

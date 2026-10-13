import React, { useEffect, useState } from 'react';
import { Navbar } from '../../components/Navbar';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { NotesWidget } from '../notes/NotesWidget';
import { TasksWidget } from '../tasks/TasksWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { ProfileTab } from '../profile/ProfileTab';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { CalendarPage } from '../calendar/CalendarPage';
import { User } from '../../types';
import { TasksProvider } from '../tasks/context/TasksContext';
import { TaskReminders } from '../tasks/components/TaskReminders';
import { TaskCalendarDndProvider } from '../task-calendar/TaskCalendarDndProvider';
import { WorkspaceLayoutProvider } from '../workspace-layout/WorkspaceLayoutProvider';

interface DashboardPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onUserUpdated, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'profile' | 'calendar'>('dashboard');
  const [calendarDate, setCalendarDate] = useState<Date>();

  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  return (
    <TasksProvider key={user.id}><WorkspaceLayoutProvider><TaskCalendarDndProvider><div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={onLogout}
      />

      <main style={{ flex: 1 }}>
        <TaskReminders onOpenOverdue={() => setActiveTab('dashboard')} />
        {activeTab === 'dashboard' ? (
          <div className="dashboard-grid">
            {/* Cột 1: Ứng dụng nghiệp vụ (SSO Launchers) & Bookmarks */}
            <section className="col-launcher">
              <AppLauncherWidget />
              <BookmarksWidget />
            </section>

            {/* Cột 2: Quản lý công việc (To-do list) */}
            <section className="col-tasks">
              <TasksWidget />
            </section>

            {/* Cột 3: Ghi chú nhanh và lịch cá nhân */}
            <section className="col-notes">
              <NotesWidget />
              <CalendarWidget onOpenCalendar={date => { setCalendarDate(date); setActiveTab('calendar'); }} />
            </section>
          </div>
        ) : activeTab === 'calendar' ? (
          <CalendarPage key={user.id} initialDate={calendarDate} userName={user.full_name} userId={user.id} />
        ) : (
          <ProfileTab user={user} onUserUpdated={onUserUpdated} />
        )}
      </main>

      <footer className="platform-footer">
        <div>
          Designed by <strong>Phòng CN & CĐS - Đông Tây Land</strong>
        </div>
        <div style={{ fontSize: '0.725rem', color: 'var(--text-sub)' }}>
          v 1.0.0
        </div>
      </footer>
    </div></TaskCalendarDndProvider></WorkspaceLayoutProvider></TasksProvider>
  );
};

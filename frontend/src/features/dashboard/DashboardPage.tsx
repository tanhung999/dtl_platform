import React, { useState } from 'react';
import { Navbar } from '../../components/Navbar';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { NotesWidget } from '../notes/NotesWidget';
import { TasksWidget } from '../tasks/TasksWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { ProfileTab } from '../profile/ProfileTab';
import { User } from '../../types';

interface DashboardPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onUserUpdated, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'profile'>('dashboard');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        user={user}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={onLogout}
      />

      <main style={{ flex: 1 }}>
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

            {/* Cột 3: Ghi chú nhanh (Sticky Notes Start.me style) */}
            <section className="col-notes">
              <NotesWidget />
            </section>
          </div>
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
    </div>
  );
};

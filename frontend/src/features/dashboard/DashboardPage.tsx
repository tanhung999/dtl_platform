import { NotesPage } from '../notes/NotesPage';
import { NoteFilter } from '../notes/noteView';
import { WorkspaceWidgets } from '../dashboard-layout/WorkspaceWidgets';
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
import { TaskCalendarDndProvider } from '../task-calendar/TaskCalendarDndProvider';
import { WorkspaceLayoutProvider } from '../workspace-layout/WorkspaceLayoutProvider';

interface DashboardPageProps {
  user: User;
  onUserUpdated: (user: User) => void;
  onLogout: () => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ user, onUserUpdated, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'profile' | 'calendar' | 'notifications' | 'admin'>('dashboard');
  const access = useAccessCapabilities(user.id);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesFilter, setNotesFilter] = useState<NoteFilter>('all');
  const [sharedOwner, setSharedOwner] = useState<string>();
  const [calendarDate, setCalendarDate] = useState<Date>();
  useEffect(() => { const open = (event: Event) => { setSharedOwner((event as CustomEvent<string>).detail); setNotesOpen(false); setActiveTab('calendar'); }; window.addEventListener('calendar:open-shared', open); return () => window.removeEventListener('calendar:open-shared', open); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [activeTab, notesOpen]);

  return (
    <TasksProvider key={user.id}><NotificationsProvider userId={user.id}><WorkspaceLayoutProvider><div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        user={user}
        activeTab={activeTab}
        canManage={access.can_manage}
        onTabChange={tab => { setNotesOpen(false); setActiveTab(tab); }}
        onOpenNotifications={() => { setNotesOpen(false); setActiveTab('notifications'); }}
        onLogout={onLogout}
      />

      <main style={{ flex: 1 }}>
        {activeTab === 'dashboard' ? (
          notesOpen ? <NotesPage initialFilter={notesFilter} onBack={() => setNotesOpen(false)} /> : <WorkspaceWidgets onOpenNotes={filter => { setNotesFilter(filter); setNotesOpen(true); }} onOpenCalendar={date => { setSharedOwner(undefined); setCalendarDate(date); setActiveTab('calendar'); }} />
        ) : activeTab === 'calendar' ? (
          <TaskCalendarDndProvider><CalendarWorkspace key={`${user.id}:${sharedOwner ?? "mine"}`} initialOwner={sharedOwner} initialDate={calendarDate} userName={user.full_name} userId={user.id} /></TaskCalendarDndProvider>
        ) : activeTab === 'notifications' ? <NotificationsPage /> : activeTab === 'admin' ? (
          <AdminPage revision={access.revision} allowed={access.can_manage} loading={access.loading} error={access.error} onChanged={access.refresh} />
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
    </div></WorkspaceLayoutProvider></NotificationsProvider></TasksProvider>
  );
};

import { NotesPage } from '../notes/NotesPage';
import { RescheduleToast } from '../rescheduling/RescheduleToast';
import { TasksPage } from '../tasks/TasksPage';
import { SharingCapabilityContext } from '../access/SharingCapabilityContext';
import { NoteFilter } from '../notes/noteView';
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'profile' | 'calendar' | 'notifications' | 'admin'>('dashboard');
  const access = useAccessCapabilities(user.id);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [notesFilter, setNotesFilter] = useState<NoteFilter>('all');
  const [sharedOwner, setSharedOwner] = useState<string>();
  const [calendarDate, setCalendarDate] = useState<Date>();
  useEffect(() => { const open = (event: Event) => { setSharedOwner((event as CustomEvent<string>).detail); setNotesOpen(false); setTasksOpen(false); setActiveTab('calendar'); }; window.addEventListener('calendar:open-shared', open); return () => window.removeEventListener('calendar:open-shared', open); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [activeTab, notesOpen, tasksOpen]);

  return (
    <SharingCapabilityContext.Provider value={access.can_share && !access.loading && !access.error}><TasksProvider key={user.id} fullPage={activeTab === 'dashboard' && tasksOpen}><NotificationsProvider userId={user.id}><div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <RescheduleToast />
      <Navbar
        user={user}
        activeTab={activeTab}
        canManage={access.can_manage}
        onTabChange={tab => { setNotesOpen(false); setTasksOpen(false); setActiveTab(tab); }}
        onOpenNotifications={() => { setNotesOpen(false); setTasksOpen(false); setActiveTab('notifications'); }}
        onLogout={onLogout}
      />

      <main style={{ flex: 1 }}>
        {activeTab === 'dashboard' ? (
          tasksOpen ? <TasksPage onBack={() => setTasksOpen(false)} /> : notesOpen ? <NotesPage initialFilter={notesFilter} onBack={() => setNotesOpen(false)} /> : <WorkspaceWidgets onOpenTasks={() => setTasksOpen(true)} onOpenNotes={filter => { setNotesFilter(filter); setNotesOpen(true); }} onOpenCalendar={date => { setSharedOwner(undefined); setCalendarDate(date); setActiveTab('calendar'); }} />
        ) : activeTab === 'calendar' ? (
          <CalendarWorkspace key={`${user.id}:${sharedOwner ?? "mine"}`} initialOwner={sharedOwner} initialDate={calendarDate} userName={user.full_name} userId={user.id} />
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
    </div></NotificationsProvider></TasksProvider></SharingCapabilityContext.Provider>
  );
};

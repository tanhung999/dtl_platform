import { ArrowUpRight, CheckSquare, Zap } from 'lucide-react';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { FeatureIcon } from '../../components/FeatureIcon';
import { User } from '../../types';
import { today } from '../calendar/dateUtils';
import './dashboard.css';

export function WorkspaceWidgets({ user, onOpenApps, onOpenCalendar, onOpenNotes, onOpenTasks }: {
  user: User; onOpenApps: () => void; onOpenCalendar: (date: Date) => void; onOpenNotes: () => void; onOpenTasks: () => void;
}) {
  return <div className="workspace-home">
    <div className="workspace-home-main">
      <section className="workspace-welcome" aria-label="Chào mừng">
        <div className="workspace-welcome-copy"><h1>Chào mừng bạn trở lại,{' '}<span>{user.full_name}!</span></h1>
          <p>Một nền tảng thống nhất cho các công cụ và dữ liệu doanh nghiệp.</p></div>
        <div className="workspace-welcome-art" aria-hidden="true"><div className="welcome-sheet"><i /><i /><i /></div><div className="welcome-chart"><i /><i /><i /></div><div className="welcome-check"><CheckSquare size={29} /></div></div>
      </section>
      <AppLauncherWidget allowedApps={user.allowed_apps ?? ''} onOpenAll={onOpenApps} />
      <section className="glass-panel widget-box workspace-shortcuts" aria-label="Truy cập nhanh">
        <div className="widget-header"><div className="widget-title"><Zap size={19} className="widget-title-icon" /><span>Truy cập nhanh</span></div></div>
        <div className="workspace-shortcut-grid">
          <button type="button" className="workspace-shortcut" onClick={onOpenNotes}><FeatureIcon name="notes" size={58} /><span>Ghi chú</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
          <button type="button" className="workspace-shortcut" onClick={onOpenTasks}><FeatureIcon name="tasks" size={58} /><span>Công việc</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
          <button type="button" className="workspace-shortcut" onClick={() => onOpenCalendar(today())}><FeatureIcon name="calendar" size={58} /><span>Lịch</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
        </div>
      </section>
      <BookmarksWidget />
    </div>
    <aside className="workspace-home-calendar" aria-label="Lịch cá nhân"><CalendarWidget onOpenCalendar={onOpenCalendar} /></aside>
  </div>;
}

import { ArrowUpRight, CheckSquare, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AppLauncherWidget } from '../apps/AppLauncherWidget';
import { BookmarksWidget } from '../bookmarks/BookmarksWidget';
import { CalendarWidget } from '../calendar/CalendarWidget';
import { FeatureIcon } from '../../components/FeatureIcon';
import { User } from '../../types';
import { today } from '../calendar/dateUtils';
import './dashboard.css';

export function WorkspaceWidgets({ user, onOpenApps, onOpenCalendar, onOpenNotes, onOpenTasks, linkRequest = 0 }: {
  user: User; onOpenApps: () => void; onOpenCalendar: (date: Date) => void; onOpenNotes: () => void; onOpenTasks: () => void; linkRequest?: number | string;
}) {
  const [linksOpen, setLinksOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const links = useRef<HTMLDivElement>(null);
  useEffect(() => { if (linkRequest) { setLinksOpen(true); setScrollRequest(value => value + 1); } }, [linkRequest]);
  useEffect(() => {
    if (!linksOpen) return;
    const frame = requestAnimationFrame(() => {
      links.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      links.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [linksOpen, scrollRequest]);
  const openLinks = () => { setLinksOpen(true); setScrollRequest(value => value + 1); };
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
          <button type="button" className="workspace-shortcut" onClick={onOpenNotes}><FeatureIcon name="notes" size={58} /><span>DT My Note</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
          <button type="button" className="workspace-shortcut" onClick={onOpenTasks}><FeatureIcon name="tasks" size={58} /><span>DT Task</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
          <button type="button" className="workspace-shortcut" onClick={() => onOpenCalendar(today())}><FeatureIcon name="calendar" size={58} /><span>DT Calendar</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
          <button type="button" className="workspace-shortcut" aria-expanded={linksOpen} aria-controls="dt-link-panel" onClick={openLinks}><FeatureIcon name="link" size={58} /><span>DT Link</span><ArrowUpRight size={15} className="shortcut-arrow" /></button>
        </div>
      </section>
      {linksOpen && <div ref={links} id="dt-link-panel" className="workspace-link-panel" role="region" aria-label="DT Link" tabIndex={-1}><BookmarksWidget /></div>}
    </div>
    <aside className="workspace-home-calendar" aria-label="Lịch cá nhân"><CalendarWidget onOpenCalendar={onOpenCalendar} /></aside>
  </div>;
}

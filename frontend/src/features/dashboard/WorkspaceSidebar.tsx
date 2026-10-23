import { ChevronLeft, ChevronRight, Home, ShieldCheck, UserRound } from 'lucide-react';
import { FeatureIcon } from '../../components/FeatureIcon';
import { workspaceRoutes } from './navigation';
import { NavLink } from 'react-router-dom';

const items = [
  { page: 'dashboard', label: 'Trang chủ', icon: Home },
  { page: 'apps', label: 'DT Platform', feature: 'platform' },
  { page: 'calendar', label: 'DT Calendar', feature: 'calendar' },
  { page: 'tasks', label: 'DT Task', feature: 'tasks' },
  { page: 'notes', label: 'DT My Note', feature: 'notes' },
  { page: 'bookmarks', label: 'DT Link', feature: 'link' },
  { page: 'profile', label: 'Hồ sơ', icon: UserRound },
] as const;

export function WorkspaceSidebar({ onOpenLinks, canManage, collapsed, onToggle }: {
  onOpenLinks: () => void; canManage: boolean; collapsed: boolean; onToggle: () => void;
}) {
  return <aside className="workspace-sidebar" aria-label="Thanh điều hướng">
    <nav aria-label="Điều hướng chính">
      {items.map(item => {
        const content = <>
        <span className="workspace-nav-icon">
          {'feature' in item ? <FeatureIcon name={item.feature} size={24} /> : <item.icon size={22} />}
        </span>
        <span className="workspace-nav-label">{item.label}</span>
      </>;
        return item.page === 'bookmarks'
          ? <button key={item.page} type="button" className="workspace-nav-item" title={item.label} onClick={onOpenLinks}>{content}</button>
          : <NavLink key={item.page} to={workspaceRoutes[item.page].path} end title={item.label} className={({ isActive }) => `workspace-nav-item${isActive ? ' is-active' : ''}`}>{content}</NavLink>;
      })}
      {canManage && <NavLink to={workspaceRoutes.admin.path} end className={({ isActive }) => `workspace-nav-item${isActive ? ' is-active' : ''}`} title="Quản trị">
        <span className="workspace-nav-icon"><ShieldCheck size={22} /></span>
        <span className="workspace-nav-label">Quản trị</span>
      </NavLink>}
    </nav>
    <button type="button" className="workspace-collapse" onClick={onToggle} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-expanded={!collapsed}>
      <span className="workspace-nav-icon">{collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</span>
      <span className="workspace-nav-label">{collapsed ? 'Mở rộng' : 'Thu gọn'}</span>
    </button>
  </aside>;
}

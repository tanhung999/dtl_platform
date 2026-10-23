import { ChevronLeft, ChevronRight, Home, ShieldCheck, UserRound } from 'lucide-react';
import { FeatureIcon } from '../../components/FeatureIcon';
import { WorkspacePage } from './navigation';

const items = [
  { page: 'dashboard', label: 'Trang chủ', icon: Home },
  { page: 'apps', label: 'DT Platform', feature: 'platform' },
  { page: 'calendar', label: 'DT Calendar', feature: 'calendar' },
  { page: 'tasks', label: 'DT Task', feature: 'tasks' },
  { page: 'notes', label: 'DT My Note', feature: 'notes' },
  { page: 'bookmarks', label: 'DT Link', feature: 'link' },
  { page: 'profile', label: 'Hồ sơ', icon: UserRound },
] as const;

export function WorkspaceSidebar({ page, onNavigate, canManage, collapsed, onToggle }: {
  page: WorkspacePage; onNavigate: (page: WorkspacePage) => void; canManage: boolean; collapsed: boolean; onToggle: () => void;
}) {
  return <aside className="workspace-sidebar" aria-label="Thanh điều hướng">
    <nav aria-label="Điều hướng chính">
      {items.map(item => <button key={item.page} type="button" className={`workspace-nav-item${page === item.page ? ' is-active' : ''}`} aria-current={page === item.page ? 'page' : undefined}
        title={item.label} onClick={() => onNavigate(item.page)}>
        <span className="workspace-nav-icon">
          {'feature' in item ? <FeatureIcon name={item.feature} size={24} /> : <item.icon size={22} />}
        </span>
        <span className="workspace-nav-label">{item.label}</span>
      </button>)}
      {canManage && <button type="button" className={`workspace-nav-item${page === 'admin' ? ' is-active' : ''}`} aria-current={page === 'admin' ? 'page' : undefined}
        title="Quản trị" onClick={() => onNavigate('admin')}>
        <span className="workspace-nav-icon"><ShieldCheck size={22} /></span>
        <span className="workspace-nav-label">Quản trị</span>
      </button>}
    </nav>
    <button type="button" className="workspace-collapse" onClick={onToggle} aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'} aria-expanded={!collapsed}>
      <span className="workspace-nav-icon">{collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</span>
      <span className="workspace-nav-label">{collapsed ? 'Mở rộng' : 'Thu gọn'}</span>
    </button>
  </aside>;
}

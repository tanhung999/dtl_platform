export type WorkspacePage = 'search' | 'dashboard' | 'apps' | 'tasks' | 'notes' | 'bookmarks' | 'calendar' | 'profile' | 'notifications' | 'admin';
export type RoutedPage = Exclude<WorkspacePage, 'bookmarks'>;

interface WorkspaceRoute {
  path: string;
  title: string;
  icon?: 'platform' | 'calendar' | 'tasks' | 'notes';
}

export const workspaceRoutes: Record<RoutedPage, WorkspaceRoute> = {
  dashboard: { path: '/homepage', title: 'Đông Tây One' },
  apps: { path: '/platform', title: 'DT Platform', icon: 'platform' },
  calendar: { path: '/calendar', title: 'DT Calendar', icon: 'calendar' },
  tasks: { path: '/tasks', title: 'DT Task', icon: 'tasks' },
  notes: { path: '/notes', title: 'DT My Note', icon: 'notes' },
  profile: { path: '/profile', title: 'Hồ sơ' },
  notifications: { path: '/notifications', title: 'Thông báo' },
  admin: { path: '/admin', title: 'Quản trị' },
  search: { path: '/search', title: 'Tìm kiếm' },
};

export function pageForPath(pathname: string): RoutedPage | undefined {
  const path = pathname.replace(/\/+$/, '').toLowerCase() || '/';
  return (Object.keys(workspaceRoutes) as RoutedPage[]).find(page => workspaceRoutes[page].path === path);
}

/** Only return to a known, same-site page after login. */
export function loginDestination(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return workspaceRoutes.dashboard.path;
  try {
    const url = new URL(from, 'https://workspace.invalid');
    if (url.origin !== 'https://workspace.invalid' || !pageForPath(url.pathname)) return workspaceRoutes.dashboard.path;
    return url.pathname + url.search + url.hash;
  } catch { return workspaceRoutes.dashboard.path; }
}

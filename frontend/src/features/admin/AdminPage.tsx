import { Building2, KeyRound, LayoutGrid, ShieldCheck, Users } from 'lucide-react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { OrganizationManagement } from '../organization/OrganizationManagement';
import { AccessManagement } from '../access/AccessManagement';
import { UserManagement } from '../users/UserManagement';
import { adminRoutes } from '../dashboard/navigation';
import { ApplicationLoginManagement } from '../apps/ApplicationLoginManagement';
import { Capabilities } from '../access/api';
import '../calendar/calendar.css';
import '../calendar-sharing/calendar-sharing.css';
import './admin.css';
import './platform-permissions.css';
import './admin-modern.css';

export function AdminPage({ allowed, capabilities, loading, error, onChanged, revision }: { allowed: boolean; capabilities: Capabilities; loading: boolean; error: string; onChanged: () => void; revision: number }) {
  const users = capabilities.can_manage;
  const organization = capabilities.can_manage;
  const permissions = capabilities.can_manage;
  const applications = capabilities.can_manage;
  const firstRoute = users ? adminRoutes.users : organization ? adminRoutes.organization : adminRoutes.permissions;
  const denied = <section className="admin-card"><p role="alert">Bạn chưa được cấp quyền quản lý mục này.</p></section>;
  return <div className="admin-page">
    <header className="admin-heading"><div className="admin-heading-icon"><ShieldCheck size={25} /></div><div><h1>Quản trị hệ thống</h1><p>Quản lý tài khoản, tổ chức và quyền truy cập.</p></div></header>
    {loading ? <p role="status">Đang kiểm tra quyền quản trị…</p> : !allowed ? <section className="admin-card"><p role="alert">{error || 'Bạn không có quyền truy cập trang quản trị.'}</p></section> : <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Danh mục quản trị"><span>QUẢN LÝ HỆ THỐNG</span>{users && <NavLink to={adminRoutes.users} className={({isActive})=>isActive?'admin-menu-active':''}><Users size={18}/>Tài khoản</NavLink>}{organization && <NavLink to={adminRoutes.organization} className={({isActive})=>isActive?'admin-menu-active':''}><Building2 size={18}/>Tổ chức</NavLink>}{(permissions || applications) && <NavLink to={adminRoutes.permissions} className={({isActive})=>isActive?'admin-menu-active':''}><KeyRound size={18}/>Phân quyền</NavLink>}{applications && <NavLink to={adminRoutes.applications} className={({isActive})=>isActive?'admin-menu-active':''}><LayoutGrid size={18}/>Đăng nhập ứng dụng</NavLink>}</aside>
      <section className="admin-content" aria-labelledby="admin-section-title"><Routes>
        <Route index element={<Navigate to={firstRoute} replace/>}/>
        <Route path="users" element={users ? <><div className="admin-section-heading"><h2 id="admin-section-title">Quản lý tài khoản</h2></div><UserManagement onChanged={onChanged}/></> : denied}/>
        <Route path="organization" element={organization ? <><div className="admin-section-heading"><h2 id="admin-section-title">Cơ cấu tổ chức</h2></div><OrganizationManagement/></> : denied}/>
        <Route path="permissions" element={(permissions || applications) ? <><div className="admin-section-heading"><h2 id="admin-section-title">Phân quyền tài khoản</h2><p>Chọn tài khoản, sau đó quản lý quyền Platform hoặc từng ứng dụng.</p></div><AccessManagement revision={revision} onChanged={onChanged} managePlatform={permissions} manageApplications={applications}/></> : denied}/>
        <Route path="applications" element={applications ? <><div className="admin-section-heading"><h2 id="admin-section-title">Đăng nhập ứng dụng</h2></div><ApplicationLoginManagement/></> : denied}/>
        <Route path="*" element={<Navigate to={firstRoute} replace/>}/>
      </Routes></section>
    </div>}
  </div>;
}

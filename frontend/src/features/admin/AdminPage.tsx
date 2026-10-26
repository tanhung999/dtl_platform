import { Building2, KeyRound, LayoutGrid, ShieldCheck, Users } from 'lucide-react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { OrganizationManagement } from '../organization/OrganizationManagement';
import { AccessManagement } from '../access/AccessManagement';
import { UserManagement } from '../users/UserManagement';
import { adminRoutes } from '../dashboard/navigation';
import { ApplicationLoginManagement } from '../apps/ApplicationLoginManagement';
import '../calendar/calendar.css';
import '../calendar-sharing/calendar-sharing.css';
import './admin.css';

export function AdminPage({ allowed, loading, error, onChanged, revision }: { allowed: boolean; loading: boolean; error: string; onChanged: () => void; revision: number }) {
  return <div className="admin-page">
    <header className="admin-heading"><div className="admin-heading-icon"><ShieldCheck size={25} /></div><div><h1>Quản trị</h1></div></header>
    {loading ? <p role="status">Đang kiểm tra quyền quản trị…</p> : !allowed ? <section className="admin-card"><p role="alert">{error || 'Bạn không có quyền truy cập trang quản trị.'}</p></section> : <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Danh mục quản trị"><span>QUẢN LÝ HỆ THỐNG</span><NavLink to={adminRoutes.users} className={({isActive})=>isActive?'admin-menu-active':''}><Users size={18}/>Tài khoản</NavLink><NavLink to={adminRoutes.organization} className={({isActive})=>isActive?'admin-menu-active':''}><Building2 size={18}/>Tổ chức</NavLink><NavLink to={adminRoutes.permissions} className={({isActive})=>isActive?'admin-menu-active':''}><KeyRound size={18}/>Phân quyền</NavLink><NavLink to={adminRoutes.applications} className={({isActive})=>isActive?'admin-menu-active':''}><LayoutGrid size={18}/>Đăng nhập ứng dụng</NavLink></aside>
      <section className="admin-content" aria-labelledby="admin-section-title"><Routes>
        <Route index element={<Navigate to={adminRoutes.users} replace/>}/>
        <Route path="users" element={<><div className="admin-section-heading"><h2 id="admin-section-title">Quản lý tài khoản</h2></div><UserManagement onChanged={onChanged}/></>}/>
        <Route path="organization" element={<><div className="admin-section-heading"><h2 id="admin-section-title">Cơ cấu tổ chức</h2></div><OrganizationManagement/></>}/>
        <Route path="permissions" element={<><div className="admin-section-heading"><h2 id="admin-section-title">Phân quyền tài khoản</h2></div><AccessManagement revision={revision} onChanged={onChanged}/></>}/>
        <Route path="applications" element={<><div className="admin-section-heading"><h2 id="admin-section-title">Đăng nhập ứng dụng</h2></div><ApplicationLoginManagement/></>}/>
        <Route path="*" element={<Navigate to={adminRoutes.users} replace/>}/>
      </Routes></section>
    </div>}
  </div>;
}

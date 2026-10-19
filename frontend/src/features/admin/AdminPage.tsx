import { ShieldCheck, Users } from 'lucide-react';
import { AccessManagement } from '../access/AccessManagement';
import '../calendar/calendar.css';
import '../calendar-sharing/calendar-sharing.css';
import './admin.css';

export function AdminPage({ allowed, loading, error, onChanged, revision }: { allowed: boolean; loading: boolean; error: string; onChanged: () => void; revision: number }) {
  return <div className="admin-page">
    <header className="admin-heading"><div className="admin-heading-icon"><ShieldCheck size={25} /></div><div><h1>Quản trị</h1><p>Quản lý quyền sử dụng các chức năng trên hệ thống.</p></div></header>
    {loading ? <p role="status">Đang kiểm tra quyền quản trị…</p> : !allowed ? <section className="admin-card"><p role="alert">{error || 'Bạn không có quyền truy cập trang quản trị.'}</p></section> : <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Danh mục quản trị"><span>QUẢN LÝ HỆ THỐNG</span><div className="admin-menu-active"><Users size={18} />Phân quyền</div></aside>
      <section className="admin-content" aria-labelledby="admin-permissions-title"><div className="admin-section-heading"><h2 id="admin-permissions-title">Phân quyền tài khoản</h2><p>Cấp khả năng sử dụng chức năng cho từng tài khoản.</p></div><AccessManagement revision={revision} onChanged={onChanged} /></section>
    </div>}
  </div>;
}

import { useState } from 'react';
import { KeyRound, ShieldCheck, Users } from 'lucide-react';
import { AccessManagement } from '../access/AccessManagement';
import { UserManagement } from '../users/UserManagement';
import '../calendar/calendar.css';
import '../calendar-sharing/calendar-sharing.css';
import './admin.css';

export function AdminPage({ allowed, loading, error, onChanged, revision }: { allowed: boolean; loading: boolean; error: string; onChanged: () => void; revision: number }) {
  const [section, setSection] = useState<'users' | 'permissions'>('users');
  return <div className="admin-page">
    <header className="admin-heading"><div className="admin-heading-icon"><ShieldCheck size={25} /></div><div><h1>Quản trị</h1></div></header>
    {loading ? <p role="status">Đang kiểm tra quyền quản trị…</p> : !allowed ? <section className="admin-card"><p role="alert">{error || 'Bạn không có quyền truy cập trang quản trị.'}</p></section> : <div className="admin-layout">
      <aside className="admin-sidebar" aria-label="Danh mục quản trị"><span>QUẢN LÝ HỆ THỐNG</span><button className={section==='users'?'admin-menu-active':''} onClick={()=>setSection('users')}><Users size={18}/>Tài khoản</button><button className={section==='permissions'?'admin-menu-active':''} onClick={()=>setSection('permissions')}><KeyRound size={18}/>Phân quyền</button></aside>
      <section className="admin-content" aria-labelledby="admin-section-title"><div className="admin-section-heading"><h2 id="admin-section-title">{section==='users'?'Quản lý tài khoản':'Phân quyền tài khoản'}</h2></div>{section==='users'?<UserManagement onChanged={onChanged}/>:<AccessManagement revision={revision} onChanged={onChanged}/>}</section>
    </div>}
  </div>;
}

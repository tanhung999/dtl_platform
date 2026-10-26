import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, KeyRound, Plus, Search, UserRound, X } from 'lucide-react';
import { ManagedUser, ManagedUserCreate, ManagedUserUpdate, usersApi } from './api';
import { requestWithTimeout } from '../../services/requestTimeout';

const emptyCreate: ManagedUserCreate = {
  username: '', email: '', full_name: '', password: '', department: '', job_title: '',
  employee_code: '', phone: '', office_location: '', platform_admin: false,
};

const editableUser = (user: ManagedUser): ManagedUserUpdate => ({
  email: user.email, full_name: user.full_name, department: user.department,
  job_title: user.job_title, employee_code: user.employee_code, phone: user.phone,
  office_location: user.office_location, is_active: user.is_active,
  platform_admin: user.platform_admin, position_id: user.position_id,
  manager_id: user.manager_id, work_location_id: user.work_location_id,
});

export function UserManagement({ onChanged }: { onChanged: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]), [selected, setSelected] = useState<ManagedUser>();
  const [query, setQuery] = useState(''), [page, setPage] = useState(1), [total, setTotal] = useState(0);
  const [createOpen, setCreateOpen] = useState(false), [create, setCreate] = useState(emptyCreate);
  const [edit, setEdit] = useState<ManagedUserUpdate>();
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const load = (signal?: AbortSignal) => usersApi.list(query, page, signal).then(result => {
    setUsers(result.items); setTotal(result.total);
    if (selected) setSelected(result.items.find(item => item.id === selected.id));
  });
  useEffect(() => {
    const controller = new AbortController(); load(controller.signal).catch(reason => {
      if (!controller.signal.aborted) setError((reason as Error).message);
    }); return () => controller.abort();
  }, [query, page]);
  const choose = (user: ManagedUser) => {
    setSelected(user); setEdit(editableUser(user));
    setNewPassword(''); setShowNewPassword(false); setError(''); setSuccess(''); setCreateOpen(false);
  };
  const submitCreate = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(''); setSuccess('');
    try {
      const created = await usersApi.create(create); setCreate(emptyCreate); setCreateOpen(false);
      setPage(1); await load(); choose(created); setSuccess('Đã tạo tài khoản hệ thống.'); onChanged();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const submitEdit = async (event: FormEvent) => {
    event.preventDefault(); if (!selected || !edit || busy) return; setBusy(true); setError(''); setSuccess('');
    try {
      const updated = await usersApi.update(selected.id, edit); setSelected(updated); setEdit(editableUser(updated)); setUsers(current => current.map(item => item.id === updated.id ? updated : item));
      setSuccess('Đã cập nhật thông tin tài khoản.'); onChanged();
    } catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const resetPassword = async () => {
    if (!selected || newPassword.length < 8 || busy) return; setBusy(true); setError(''); setSuccess('');
    try { await usersApi.resetPassword(selected.id, newPassword); setNewPassword(''); setSuccess('Đã đặt mật khẩu mới.'); }
    catch (reason) { setError((reason as Error).message); } finally { setBusy(false); }
  };
  const feedback = (success || error) && <div className="user-editor-feedback" aria-live="polite">
    {success && <p className="access-success" role="status"><CheckCircle2 size={17} />{success}</p>}
    {error && <p className="alert-error" role="alert">{error}</p>}
  </div>;
  return <div className="user-admin-grid">
    <section className="admin-card user-admin-list">
      <div className="user-admin-toolbar"><label><Search size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Tìm tên, email, mã nhân viên" /></label><button className="btn btn-primary btn-sm" onClick={() => { setCreateOpen(true); setSelected(undefined); setEdit(undefined); setError(''); setSuccess(''); }}><Plus size={15} />Tạo tài khoản</button></div>
      <p className="access-list-summary">{total} tài khoản</p>
      <div className="user-admin-items">{users.map(user => <button type="button" key={user.id} className={selected?.id === user.id ? 'is-selected' : ''} onClick={() => choose(user)}><span className="access-avatar">{user.full_name.charAt(0).toUpperCase()}</span><span><strong>{user.full_name}</strong><small>@{user.username} · {user.email}</small></span><em className={user.is_active ? 'is-active' : ''}>{user.is_active ? 'Hoạt động' : 'Đã khóa'}</em></button>)}</div>
      <div className="access-pagination"><button className="btn btn-outline btn-sm" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Trước</button><span>Trang {page}</span><button className="btn btn-outline btn-sm" disabled={page * 20 >= total} onClick={() => setPage(value => value + 1)}>Sau</button></div>
    </section>
    <section className="admin-card user-admin-editor">
      {createOpen ? <form onSubmit={submitCreate}><div className="user-editor-title"><div><h2>Tạo tài khoản</h2><p>Tài khoản dùng chung cho Platform và các ứng dụng được cấp quyền.</p></div><button type="button" className="icon-btn" onClick={() => setCreateOpen(false)} aria-label="Đóng"><X size={18} /></button></div>{feedback}<UserFields mode="create" value={create} onChange={setCreate} /><button className="btn btn-primary" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo tài khoản'}</button></form> : selected && edit ? <form onSubmit={submitEdit}><div className="user-editor-title"><div><h2>{selected.full_name}</h2><p>@{selected.username} · {selected.identity_subject ? 'Đã kích hoạt' : 'Chưa kích hoạt'}</p></div></div>{feedback}<UserFields mode="edit" currentId={selected.id} username={selected.username} value={edit} onChange={setEdit} /><button className="btn btn-primary" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button><div className="user-password-reset"><div><KeyRound size={18} /><div><strong>Đặt lại mật khẩu</strong><p>Mật khẩu có hiệu lực ngay</p></div></div><div><div className="user-password-input"><input type={showNewPassword ? 'text' : 'password'} minLength={8} maxLength={128} value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="Tối thiểu 8 ký tự" /><button type="button" onClick={() => setShowNewPassword(value => !value)} aria-label={showNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} title={showNewPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>{showNewPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div><button type="button" className="btn btn-outline btn-sm" disabled={busy || newPassword.length < 8} onClick={resetPassword}>Đặt mật khẩu</button></div></div></form> : <div className="admin-empty"><UserRound size={34} /><p>Chọn một tài khoản để chỉnh sửa hoặc tạo tài khoản mới.</p></div>}
    </section>
  </div>;
}

type OrgItem = { id: string; name: string; is_active: boolean; department_id?: string; job_level_id?: string; rank?: number; is_management?: boolean };
type OrgCatalog = { departments: OrgItem[]; positions: OrgItem[]; job_levels: OrgItem[]; work_locations: OrgItem[] };
type ManagerCandidate = { id: string; full_name: string; position_name: string; job_level_name: string; department_id: string };
function UserFields({ mode, value, onChange, currentId, username }: ({ mode: 'create'; value: ManagedUserCreate; onChange: (value: ManagedUserCreate) => void; currentId?: never; username?: never } | { mode: 'edit'; value: ManagedUserUpdate; onChange: (value: ManagedUserUpdate) => void; currentId: string; username: string })) {
  const change = (key: string, next: string | boolean) => onChange({ ...value, [key]: next } as never);
  const changeMany = (next: Record<string, string | boolean>) => onChange({ ...value, ...next } as never);
  const [organization, setOrganization] = useState<OrgCatalog>({ departments: [], positions: [], job_levels: [], work_locations: [] });
  const [departmentId, setDepartmentId] = useState(''); const [managers, setManagers] = useState<ManagerCandidate[]>([]);
  useEffect(() => {
    requestWithTimeout<OrgCatalog>('/api/admin/organization').then(data => {
      setOrganization(data);
      const legacyDepartment = data.departments.find(x => x.name.trim().toLocaleLowerCase('vi-VN') === value.department.trim().toLocaleLowerCase('vi-VN'));
      const position = data.positions.find(x => x.id === value.position_id) || data.positions.find(x => x.department_id === legacyDepartment?.id && x.name.trim().toLocaleLowerCase('vi-VN') === value.job_title.trim().toLocaleLowerCase('vi-VN'));
      setDepartmentId(position?.department_id || legacyDepartment?.id || '');
      if (!value.position_id && position) changeMany({ position_id: position.id, manager_id: value.manager_id || '' });
    }).catch(() => { });
  }, []);
  useEffect(() => { if (!value.position_id) { setManagers([]); return; } const params = new URLSearchParams({ position_id: value.position_id }); if (currentId) params.set('exclude_user_id', currentId); requestWithTimeout<ManagerCandidate[]>(`/api/admin/users/manager-candidates?${params}`, { cache: 'no-store' }).then(setManagers).catch(() => setManagers([])); }, [value.position_id, currentId]);
  return <div className="user-fields">
    {mode === 'create' && <><label><span>Tên đăng nhập</span><input required minLength={3} maxLength={80} value={value.username} onChange={event => change('username', event.target.value)} /></label><label><span>Mật khẩu khởi tạo</span><input required type="password" minLength={8} maxLength={128} value={value.password} onChange={event => change('password', event.target.value)} /></label></>}
    {mode === 'edit' && <label><span>Tên đăng nhập</span><input value={username} disabled title="Tên đăng nhập không thể thay đổi" /></label>}
    <label><span>Họ và tên</span><input required minLength={2} maxLength={120} value={value.full_name} onChange={event => change('full_name', event.target.value)} /></label><label><span>Email</span><input required type="email" maxLength={120} value={value.email} onChange={event => change('email', event.target.value)} /></label>
    <label><span>Phòng ban</span><select value={departmentId} onChange={event => { setDepartmentId(event.target.value); changeMany({ position_id: '', manager_id: '' }); }}><option value="">Chọn phòng ban</option>{organization.departments.filter(x => x.is_active).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label><span>Vị trí / chức danh</span><select value={value.position_id ?? ''} onChange={event => changeMany({ position_id: event.target.value, manager_id: '' })} disabled={!departmentId}><option value="">Chọn vị trí</option>{organization.positions.filter(x => x.is_active && x.department_id === departmentId).map(x => { const level = organization.job_levels.find(level => level.id === x.job_level_id); return <option key={x.id} value={x.id}>{x.name}{level ? ` · ${level.name}${level.is_management ? ' (Quản lý)' : ' (Nhân viên)'}` : ''}</option> })}</select></label>
    <label><span>Quản lý trực tiếp</span><select value={value.manager_id ?? ''} onChange={event => change('manager_id', event.target.value)} disabled={!value.position_id}><option value="">Không có</option>{managers.map(x => <option key={x.id} value={x.id}>{x.full_name} · {x.position_name} · {x.job_level_name}</option>)}</select></label>
    <label><span>Mã nhân viên</span><input maxLength={50} value={value.employee_code} onChange={event => change('employee_code', event.target.value)} /></label><label><span>Số điện thoại</span><input maxLength={30} value={value.phone} onChange={event => change('phone', event.target.value)} /></label>
    <label className="user-field-wide"><span>Vị trí làm việc</span><select value={value.work_location_id ?? ''} onChange={event => change('work_location_id', event.target.value)}><option value="">Chọn nơi làm việc</option>{organization.work_locations.filter(x => x.is_active).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label className="user-check"><input type="checkbox" checked={value.platform_admin} onChange={event => change('platform_admin', event.target.checked)} /><span>Quản trị Platform</span></label>{mode === 'edit' && <label className="user-check"><input type="checkbox" checked={value.is_active} onChange={event => change('is_active', event.target.checked)} /><span>Tài khoản hoạt động</span></label>}
  </div>;
}

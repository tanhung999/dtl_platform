import { FormEvent, useEffect, useRef, useState } from 'react';
import { Building2, Check, MapPin, Pencil, Plus, Search, Trash2, Users, X } from 'lucide-react';
import { requestWithTimeout } from '../../services/requestTimeout';
import { sameFields } from '../../services/unchanged';

type Item = { id: string; code: string; name: string; is_active: boolean; department_id?: string };
type Catalog = { departments: Item[]; positions: Item[]; work_locations: Item[] };
type Kind = 'departments' | 'positions' | 'work-locations';
const groups = [
  { key: 'departments', label: 'Phòng ban', icon: Building2 },
  { key: 'positions', label: 'Vị trí / chức danh', icon: Users },
  { key: 'work-locations', label: 'Nơi làm việc', icon: MapPin },
] as const;

export function OrganizationManagement() {
  const [data, setData] = useState<Catalog>({ departments: [], positions: [], work_locations: [] });
  const [kind, setKind] = useState<Kind>('departments');
  const [editing, setEditing] = useState<Item>();
  const [name, setName] = useState(''), [code, setCode] = useState(''), [department, setDepartment] = useState('');
  const [active, setActive] = useState(true), [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  const reset = () => { setEditing(undefined); setName(''); setCode(''); setDepartment(''); setActive(true); };
  const load = () => requestWithTimeout<Catalog>('/api/admin/organization').then(setData);
  useEffect(() => { load().catch(e => setError(e.message)).finally(() => setLoading(false)); }, []);
  const payload = { name: name.trim(), code: code.trim().toUpperCase(), is_active: active, department_id: kind === 'positions' ? department : null };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (editing && sameFields(payload, { name: editing.name, code: editing.code, is_active: editing.is_active, department_id: editing.department_id || null })) {
      setSuccess('Thông tin chưa thay đổi.'); setError(''); return;
    }
    submitting.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      await requestWithTimeout(`/api/admin/organization/${kind}${editing ? '/' + editing.id : ''}`, { method: editing ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      setSuccess(editing ? 'Đã lưu thay đổi.' : 'Đã thêm thành công.'); reset();
      await load().catch(() => { setSuccess(''); setError('Dữ liệu đã được lưu, nhưng chưa tải lại được danh sách. Hãy tải lại trang để xem cập nhật.'); });
    } catch (reason) { setError((reason as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  };
  const remove = async (item: Item) => {
    if (submitting.current) return;
    if (!window.confirm(`Xóa “${item.name}”? Dữ liệu đang được sử dụng sẽ được giữ lại.`)) return;
    submitting.current = true; setBusy(true); setError(''); setSuccess('');
    try {
      await requestWithTimeout(`/api/admin/organization/${kind}/${item.id}`, { method: 'DELETE' });
      if (editing?.id === item.id) reset();
      setSuccess('Đã xóa thành công.');
      await load().catch(() => { setSuccess(''); setError('Dữ liệu đã được xóa, nhưng chưa tải lại được danh sách. Hãy tải lại trang để xem cập nhật.'); });
    } catch (reason) { setError((reason as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  };
  const items = kind === 'work-locations' ? data.work_locations : data[kind];
  const filtered = items.filter(item => `${item.name} ${item.code} ${data.departments.find(x => x.id === item.department_id)?.name || ''}`.toLocaleLowerCase('vi-VN').includes(query.trim().toLocaleLowerCase('vi-VN')));
  return <section className="admin-card organization-admin">
    <div className="organization-tabs">{groups.map(({ key, label, icon: Icon }) => <button type="button" key={key} disabled={busy} className={`btn btn-sm ${kind === key ? 'btn-secondary' : 'btn-outline'}`} aria-pressed={kind === key} onClick={() => { setKind(key); reset(); setQuery(''); setError(''); setSuccess(''); }}><Icon size={16}/>{label}</button>)}</div>
    <form className={`organization-form organization-simple-form is-${kind}`} onSubmit={submit} aria-busy={busy}>
      <label><span>Mã</span><input className="form-input" value={code} onChange={e => setCode(e.target.value)} required maxLength={30} disabled={busy} placeholder="Ví dụ: NS"/></label>
      <label><span>Tên {kind === 'departments' ? 'phòng ban' : kind === 'positions' ? 'vị trí / chức danh' : 'nơi làm việc'}</span><input className="form-input" value={name} onChange={e => setName(e.target.value)} required maxLength={120} disabled={busy} placeholder={kind === 'positions' ? 'Ví dụ: Trưởng phòng Nhân sự' : 'Nhập tên'}/></label>
      {kind === 'positions' && <label><span>Thuộc phòng ban</span><select className="form-input" value={department} onChange={e => setDepartment(e.target.value)} required disabled={busy}><option value="">Chọn phòng ban</option>{data.departments.filter(x => x.is_active || x.id === department).map(x => <option key={x.id} value={x.id}>{x.name}{!x.is_active ? ' · Đã ngừng hoạt động' : ''}</option>)}</select></label>}
      <div className="organization-form-actions"><button className="btn btn-primary" disabled={busy}><Plus size={16}/>{busy ? 'Đang lưu…' : editing ? 'Lưu thay đổi' : 'Thêm'}</button>{editing && <button type="button" className="btn btn-outline" disabled={busy} onClick={reset}><X size={15}/>Hủy</button>}</div>
      {editing && <label className="organization-active-control"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} disabled={busy}/>Đang hoạt động</label>}
      {editing && kind === 'positions' && editing.department_id !== department && <p className="organization-transfer-warning">Chuyển vị trí sang phòng ban khác sẽ thu hồi quyền giao việc đã cấp riêng của các tài khoản đang giữ vị trí này.</p>}
    </form>
    {error && <p className="alert-error" role="alert">{error}</p>}{success && <p className="access-success" role="status"><Check size={16}/>{success}</p>}
    <div className="organization-list-toolbar"><label><Search size={16}/><input aria-label="Tìm trong cơ cấu tổ chức" placeholder="Tìm theo tên hoặc mã…" value={query} onChange={e => setQuery(e.target.value)}/></label><span>{filtered.length} mục</span></div>
    <div className="organization-list" aria-busy={loading}>{loading ? <p role="status">Đang tải…</p> : !filtered.length ? <p className="organization-empty">{query.trim() ? 'Không tìm thấy kết quả phù hợp.' : 'Chưa có dữ liệu trong nhóm này.'}</p> : filtered.map(item => <div key={item.id}>
      <strong>{item.name}<small className={`organization-state ${item.is_active ? '' : 'is-inactive'}`}>{item.is_active ? 'Hoạt động' : 'Đã ngừng'}</small></strong>
      <span>{item.code}{item.department_id ? ` · ${data.departments.find(x => x.id === item.department_id)?.name || ''}` : ''}</span>
      <div className="organization-item-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setEditing(item); setName(item.name); setCode(item.code); setDepartment(item.department_id || ''); setActive(item.is_active); setError(''); setSuccess(''); }}><Pencil size={14}/>Sửa</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => void remove(item)} aria-label={`Xóa ${item.name}`}><Trash2 size={14}/></button></div>
    </div>)}</div>
  </section>;
}

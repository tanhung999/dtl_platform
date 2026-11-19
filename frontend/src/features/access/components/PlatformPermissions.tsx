import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, Check, Save, ShieldCheck } from 'lucide-react';
import { Account, accessApi, AssignmentScope, PlatformPolicy } from '../api';
import { platformPermissions } from '../platformPermissions';

export function PlatformPermissions({ target, revision, onChanged, onBusy, onDirty }: {
  target: Account; revision: number; onChanged: () => void;
  onBusy: (value: boolean) => void; onDirty: (value: boolean) => void;
}) {
  const [saved, setSaved] = useState<PlatformPolicy>();
  const [draft, setDraft] = useState<string[]>([]);
  const emptyScope: AssignmentScope = { mode: 'current_department', department_ids: [] };
  const [scope, setScope] = useState<AssignmentScope>(emptyScope);
  const [followerDepartments, setFollowerDepartments] = useState<string[]>([]);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false), [confirm, setConfirm] = useState(false);
  const [retry, setRetry] = useState(0);
  const scopeKey = (value: AssignmentScope) => JSON.stringify([value.mode, [...value.department_ids].sort()]);
  const dirty = !!saved && (JSON.stringify([...draft].sort()) !== JSON.stringify([...saved.permissions].sort()) || scopeKey(scope) !== scopeKey(saved.assignment_scope) || JSON.stringify([...followerDepartments].sort()) !== JSON.stringify([...(saved.follower_department_ids || [])].sort()));
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  useEffect(() => {
    const controller = new AbortController();
    accessApi.platformPolicy(target.id, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      if (dirtyRef.current) return;
      setSaved(value); setDraft(value.permissions); setScope(value.assignment_scope); setFollowerDepartments(value.follower_department_ids || []); setError('');
    }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [target.id, revision, retry]);
  const update = (next: string[]) => { setDraft(next); if (!next.includes('tasks.assign') || next.includes('access.assignments.manage')) setScope(emptyScope); if (!next.includes('calendar.followers.cross_department') || next.includes('access.assignments.manage')) setFollowerDepartments([]); setConfirm(false); setSuccess(''); };
  const admin = draft.includes('access.assignments.manage');
  const assigning = draft.includes('tasks.assign');
  const canExpandFollowers = draft.includes('calendar.followers.cross_department');
  const invalidScope = assigning && !admin && (!saved?.home_department_id || scope.mode === 'selected_departments' && !scope.department_ids.length);
  const invalidFollowerScope = canExpandFollowers && !admin && (!saved?.home_department_id || !followerDepartments.length);
  const losesSharing = !!saved?.permissions.includes('calendar.share.manage') && !draft.includes('calendar.share.manage');
  const save = async () => {
    if (!saved || busy || !dirty) return;
    if (losesSharing && !confirm) { setConfirm(true); return; }
    setBusy(true); onBusy(true); setError(''); setSuccess('');
    try {
      const result = await accessApi.savePlatformPolicy(target.id, saved, draft, scope, followerDepartments);
      dirtyRef.current = false; setSaved(result); setDraft(result.permissions); setScope(result.assignment_scope); setFollowerDepartments(result.follower_department_ids || []); setConfirm(false);
      setSuccess('Đã lưu quyền Platform.'); onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); onBusy(false); }
  };
  return <div className="platform-permissions">
    <div className="access-group-heading"><ShieldCheck size={20}/><h3>Quyền Platform</h3></div>
    {!saved && !error && <p role="status">Đang tải quyền Platform…</p>}
    {saved && <>
      <fieldset className="platform-permission-set" disabled={busy || !target.is_active}><legend>Quản trị hệ thống</legend>
        {platformPermissions.filter(item => item.group === 'admin').map(item => <label key={item.code} className={`platform-permission-option ${draft.includes(item.code) ? 'is-checked' : ''}`}>
          <input type="checkbox" checked={draft.includes(item.code)} onChange={event => update(event.target.checked ? [...draft, item.code] : draft.filter(code => code !== item.code))}/>
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
        </label>)}
      </fieldset>
      <fieldset className="platform-permission-set" disabled={busy || !target.is_active}><legend><CalendarDays size={16}/>Lịch và công việc</legend>
        {platformPermissions.filter(item => item.group === 'workspace').map(item => <label key={item.code} className={`platform-permission-option ${draft.includes(item.code) ? 'is-checked' : ''}`}>
          <input type="checkbox" checked={draft.includes(item.code) || item.code === 'tasks.assign' && admin} disabled={item.code === 'tasks.assign' && (admin || !saved.home_department_id && !assigning)} onChange={event => update(event.target.checked ? [...draft, item.code] : draft.filter(code => code !== item.code))}/>
          <span><strong>{item.name}</strong><small>{item.description}</small></span>
        </label>)}
        {canExpandFollowers && !admin && <div className="assignment-scope-editor">
          <strong>Phạm vi thêm người theo dõi</strong>
          <p>Người dùng vẫn thêm được người cùng phòng ban. Chọn thêm các phòng ban được phép.</p>
          {!saved.home_department_id && <p>Hãy gán tài khoản vào phòng ban đang hoạt động trước.</p>}
          <div className="assignment-department-options">{saved.departments.filter(item => item.id !== saved.home_department_id && (item.is_active || followerDepartments.includes(item.id))).map(item => <label key={item.id}><input type="checkbox" checked={followerDepartments.includes(item.id)} disabled={busy || !item.is_active} onChange={event => { setFollowerDepartments(event.target.checked ? [...followerDepartments, item.id] : followerDepartments.filter(id => id !== item.id)); setSuccess(''); }}/>{item.name}{!item.is_active && <small>Đã ngừng hoạt động</small>}</label>)}</div>
          {!followerDepartments.length && <p>Chọn ít nhất một phòng ban để mở rộng phạm vi.</p>}
        </div>}
        {admin && <p className="access-permission-note">Quản trị Platform có thể giao việc và thêm người theo dõi ở mọi phòng ban.</p>}
        {!admin && !saved.home_department_id && <p className="access-permission-note">Hãy gán vị trí thuộc phòng ban đang hoạt động trước khi cấp quyền giao việc.</p>}
      </fieldset>
      {assigning && !admin && <div className="assignment-scope-editor"><strong>Phạm vi giao việc</strong>
        <label className="assignment-scope-choice"><input type="radio" name={`assignment-scope-${target.id}`} checked={scope.mode === 'current_department'} disabled={busy} onChange={() => { setScope(emptyScope); setSuccess(''); }}/><span>Phòng ban hiện tại<small>{saved.departments.find(item => item.id === saved.home_department_id)?.name || 'Chưa có phòng ban hợp lệ'}</small></span></label>
        <label className="assignment-scope-choice"><input type="radio" name={`assignment-scope-${target.id}`} checked={scope.mode === 'selected_departments'} disabled={busy} onChange={() => { setScope({ mode: 'selected_departments', department_ids: [] }); setSuccess(''); }}/><span>Chọn phòng ban<small>Có thể chọn nhiều phòng ban.</small></span></label>
        {scope.mode === 'selected_departments' && <div className="assignment-department-options">{saved.departments.filter(item => item.is_active || scope.department_ids.includes(item.id)).map(item => <label key={item.id}><input type="checkbox" checked={scope.department_ids.includes(item.id)} disabled={busy} onChange={event => { setScope({ ...scope, department_ids: event.target.checked ? [...scope.department_ids, item.id] : scope.department_ids.filter(id => id !== item.id) }); setSuccess(''); }}/>{item.name}{!item.is_active && <small>Đã ngừng hoạt động</small>}</label>)}{!saved.departments.length && <p>Chưa có phòng ban.</p>}</div>}
        <p>Đổi phòng ban của tài khoản sẽ thu hồi quyền giao việc và phạm vi đã cấp.</p>
      </div>}
      {confirm && <div className="access-revoke-confirm" role="alert"><strong><AlertTriangle size={16}/> Thu hồi quyền chia sẻ lịch?</strong><p>Những người đang được tài khoản này chia sẻ lịch sẽ mất quyền xem. Cấp lại không khôi phục các lượt chia sẻ cũ.</p></div>}
      <div className="platform-policy-footer"><span>{dirty ? 'Có thay đổi chưa lưu' : 'Quyền đang áp dụng'}</span><div>
        {dirty && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { update(saved.permissions); setScope(saved.assignment_scope); setFollowerDepartments(saved.follower_department_ids || []); setError(''); }}>Hủy thay đổi</button>}
        <button type="button" className="btn btn-primary btn-sm" disabled={!dirty || busy || !target.is_active || invalidScope || invalidFollowerScope} onClick={() => void save()}><Save size={15}/>{busy ? 'Đang lưu…' : confirm ? 'Xác nhận và lưu' : 'Lưu quyền Platform'}</button>
      </div></div>
    </>}
    {error && <div className="alert-error" role="alert"><p>{error}</p><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { dirtyRef.current = false; setSaved(undefined); setDraft([]); setFollowerDepartments([]); setConfirm(false); setRetry(value => value + 1); }}>Tải lại quyền</button></div>}
    {success && <p className="access-success" role="status"><Check size={16}/>{success}</p>}
  </div>;
}

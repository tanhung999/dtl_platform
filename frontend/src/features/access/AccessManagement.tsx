import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, ChevronDown, ChevronUp, History, LayoutGrid, Save, UserRound } from 'lucide-react';
import { accessApi, Account } from './api';
import { AccessAccountList } from './components/AccessAccountList';
import { AccessHistory } from './components/AccessHistory';
import { useMutationChecking } from '../mutations/useMutationChecking';
import { ApiError } from '../../services/api';
import { appsApi, UserApplicationAccess } from '../apps/api';
import { WorkflowAccountLinker } from './components/WorkflowAccountLinker';

export function AccessManagement({ onChanged, revision }: { onChanged: () => void; revision: number }) {
  const checking=useMutationChecking();
  const [target, setTarget] = useState<Account>();
  const [busy, setBusy] = useState(false), [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [applications, setApplications] = useState<UserApplicationAccess[]>([]);
  const [applicationBusy, setApplicationBusy] = useState<string>();
  const [configuredApp, setConfiguredApp] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({});
  const targetRef=useRef(target);targetRef.current=target;
  useEffect(()=>{
    if(!target?.id)return;const controller=new AbortController();
    accessApi.account(target.id,controller.signal).then(value=>{if(!controller.signal.aborted&&targetRef.current?.id===value.id&&value.access_version>=targetRef.current.access_version){if(targetRef.current.access_version!==value.access_version)setConfirmRevoke(false);setTarget(value);}}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});
    return()=>controller.abort();
  },[target?.id,revision]);
  useEffect(() => {
    if (!target?.id) { setApplications([]); return; }
    let active = true;
    appsApi.listUserAccess(target.id)
      .then(value => { if (active) { setApplications(value); setProjectDrafts(Object.fromEntries(value.map(item => [item.key, item.project_names.join(', ')]))); } })
      .catch(reason => { if (active) setError((reason as Error).message); });
    return () => { active = false; };
  }, [target?.id, revision]);
  const choose = (value: Account) => {
    if (busy) return;
    setTarget(value); setConfirmRevoke(false); setError(''); setSuccess('');
  };
  const save = async () => {
    if (!target || busy) return;
    const account = target;
    setBusy(true); setError(''); setSuccess('');
    try {
      const result=await accessApi.assign(account, !account.can_share);
      setTarget(current => current?.id === account.id ? { ...current, can_share: result.can_share, access_version: result.access_version } : current);
      setConfirmRevoke(false);
      setSuccess(account.can_share ? 'Đã thu hồi quyền chia sẻ lịch.' : 'Đã cấp quyền chia sẻ lịch.');
      onChanged();
    } catch (reason) { setError((reason as Error).message); if(reason instanceof ApiError&&reason.status===409){try{setTarget(await accessApi.account(account.id));setConfirmRevoke(false);}catch{/* Keep the original conflict message. */}} }
    finally { setBusy(false); }
  };
  const setAppAccess = async (application: UserApplicationAccess) => {
    if (!target || applicationBusy) return;
    setApplicationBusy(application.key); setError(''); setSuccess('');
    try {
      const result = await appsApi.setUserAccess(application.key, target.id, { enabled: !application.enabled });
      setApplications(current => current.map(item => item.key === application.key ? result : item));
      setSuccess(result.enabled ? `Đã cấp quyền vào ${application.display_name}.` : `Đã thu hồi quyền vào ${application.display_name}.`);
      onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setApplicationBusy(undefined); }
  };
  const saveAppPolicy = async (application: UserApplicationAccess, changes: Partial<Pick<UserApplicationAccess, 'role_key' | 'permission_keys' | 'project_names'>>) => {
    if (!target || applicationBusy) return;
    setApplicationBusy(application.key); setError(''); setSuccess('');
    try {
      const result = await appsApi.setUserAccess(application.key, target.id, {
        enabled: true,
        role_key: changes.role_key === undefined ? application.role_key : changes.role_key,
        permission_keys: changes.permission_keys === undefined ? application.permission_keys : changes.permission_keys,
        project_names: changes.project_names === undefined ? application.project_names : changes.project_names,
      });
      setApplications(current => current.map(item => item.key === application.key ? result : item));
      setProjectDrafts(current => ({ ...current, [application.key]: result.project_names.join(', ') }));
      setSuccess(`Đã cập nhật phân quyền ${application.display_name}.`); onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setApplicationBusy(undefined); }
  };
  return <><div className="access-management">
    <AccessAccountList selectedId={target?.id} onSelect={choose} disabled={busy} revision={revision} />
    <section className="admin-card access-permissions-card" aria-labelledby="access-permissions-heading">
      <h2 id="access-permissions-heading">Quyền của tài khoản</h2>
      {!target ? <div className="admin-empty"><UserRound size={32} /><p>Chọn một tài khoản ở bên trái để quản lý quyền.</p></div> : <>
        <div className="access-selected-account"><div className="access-avatar">{target.full_name.charAt(0).toUpperCase()}</div><div><h3>{target.full_name}</h3><span>@{target.username}</span></div></div>
        <div className="access-central-note"><strong>{applications.filter(item=>item.enabled).length}/{applications.length} ứng dụng được cấp</strong><span>Role và permission bên dưới là nguồn phân quyền duy nhất cho các website tích hợp.</span></div>
        <div className="access-permission-group"><div className="access-group-heading"><LayoutGrid size={19} /><h3>Ứng dụng doanh nghiệp</h3></div>
          {!applications.length && <p className="access-permission-note">Chưa có ứng dụng nào được đăng ký.</p>}
          {applications.map(application => <div className="access-application-block" key={application.key}><div className="access-application-row">
            <div><h4>{application.display_name}</h4><p>{application.description || application.key}</p>{application.enabled && application.role_display_name && <span className="access-role-badge">{application.role_display_name} · {application.permission_keys.length} quyền</span>}</div>
            <div className="access-application-actions">{application.enabled && application.roles.length > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfiguredApp(current => current === application.key ? undefined : application.key)}>Cấu hình <ChevronDown size={14}/></button>}<button type="button" className={`btn btn-sm ${application.enabled ? 'btn-danger-outline' : 'btn-primary'}`} disabled={!!applicationBusy || !target.is_active} onClick={() => { void setAppAccess(application); }}>
              {applicationBusy === application.key ? 'Đang lưu…' : application.enabled ? 'Thu hồi' : 'Cấp quyền'}
            </button></div>
          </div>{application.enabled && configuredApp === application.key && application.roles.length > 0 && <div className="access-app-policy">
            <label><span>Role nghiệp vụ</span><select value={application.role_key || ''} disabled={!!applicationBusy} onChange={event => { const role=application.roles.find(item=>item.key===event.target.value); if(role) void saveAppPolicy(application,{role_key:role.key,permission_keys:role.permission_keys}); }}>{application.roles.map(role=><option key={role.key} value={role.key}>{role.display_name}</option>)}</select></label>
            <div className="access-policy-heading"><strong>Permission hiệu lực</strong><span>{application.permission_keys.length}/{application.permissions.length}</span></div>
            <div className="access-permission-grid">{application.permissions.map(permission=><label key={permission.code} title={permission.code}><input type="checkbox" checked={application.permission_keys.includes(permission.code)} disabled={!!applicationBusy} onChange={event=>{const next=event.target.checked?[...application.permission_keys,permission.code]:application.permission_keys.filter(code=>code!==permission.code);void saveAppPolicy(application,{permission_keys:next});}}/><span>{permission.display_name}</span></label>)}</div>
            <label><span>Phạm vi dự án</span><textarea rows={2} value={projectDrafts[application.key] || ''} placeholder="Tên dự án, cách nhau bằng dấu phẩy" onChange={event=>setProjectDrafts(current=>({...current,[application.key]:event.target.value}))}/></label>
            <button type="button" className="btn btn-primary btn-sm access-policy-save" disabled={!!applicationBusy} onClick={()=>void saveAppPolicy(application,{project_names:(projectDrafts[application.key]||'').split(',').map(value=>value.trim()).filter(Boolean)})}><Save size={14}/>Lưu phạm vi dự án</button>
          </div>}{application.key === 'workflows' && <WorkflowAccountLinker key={target.id} targetId={target.id} revision={revision} onLinked={onChanged}/>}</div>)}
        </div>
        <div className="access-permission-group"><div className="access-group-heading"><CalendarDays size={19} /><h3>Lịch cá nhân</h3></div>
          <div className="access-permission-row"><div><h4>Chia sẻ lịch cá nhân</h4><p>Cho phép tài khoản chọn người được xem lịch và phạm vi Sự kiện, Công việc, Ghi chú.</p></div><span className={`access-status ${target.can_share ? 'is-enabled' : ''}`}>{target.can_share ? 'Đã cấp' : 'Chưa cấp'}</span></div>
          <p className="access-permission-note">Quyền này áp dụng cho lịch của chính tài khoản, không cho phép xem lịch của người khác.</p>
          {confirmRevoke ? <div className="access-revoke-confirm" role="alert"><strong>Thu hồi quyền chia sẻ lịch?</strong><p>Tất cả người đang được tài khoản này chia sẻ lịch cũng sẽ mất quyền xem. Cấp lại không tự khôi phục các quyền xem cũ.</p><div className="access-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmRevoke(false)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang thu hồi…' : 'Xác nhận thu hồi'}</button></div></div> : <button type="button" className={`btn btn-sm ${target.can_share ? 'btn-danger-outline' : 'btn-primary'}`} disabled={busy||!target.is_active} onClick={() => target.can_share ? setConfirmRevoke(true) : save()}>{busy ? 'Đang lưu…' : target.can_share ? 'Thu hồi quyền chia sẻ' : 'Cho phép chia sẻ lịch'}</button>}
        </div>
      </>}
      {success && <p className="access-success" role="status"><CheckCircle2 size={17} />{success}</p>}
      {checking&&busy&&<p role="status">Đang kiểm tra lại kết quả…</p>}
      {error && <p className="alert-error" role="alert">{error}</p>}
    </section>
  </div>
    <div className="access-history-toggle-row"><button type="button" className="btn btn-outline access-history-toggle" aria-expanded={historyOpen} aria-controls="access-history-panel" onClick={()=>setHistoryOpen(value=>!value)}><History size={16}/>{historyOpen?'Ẩn lịch sử thay đổi':'Xem lịch sử thay đổi'}{historyOpen?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button></div>
    {historyOpen&&<AccessHistory id="access-history-panel" targetId={target?.id} revision={revision}/>}</>;
}

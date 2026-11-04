import { useEffect, useRef, useState } from 'react';
import { ShieldCheck, CheckCircle2, ChevronDown, ChevronUp, History, LayoutGrid, Save, UserRound } from 'lucide-react';
import { accessApi, Account } from './api';
import { AccessAccountList } from './components/AccessAccountList';
import { AccessHistory } from './components/AccessHistory';
import { appsApi, UserApplicationAccess } from '../apps/api';
import { ApplicationAccountLifecycle } from './components/ApplicationAccountLifecycle';
import { sameFields } from '../../services/unchanged';
import { PlatformPermissions } from './components/PlatformPermissions';

export function AccessManagement({ onChanged, revision, managePlatform, manageApplications }: { onChanged: () => void; revision: number; managePlatform: boolean; manageApplications: boolean }) {
  const [tab, setTab] = useState(managePlatform ? 'platform' : 'applications');
  const activeTab = managePlatform && tab === 'platform' ? 'platform' : manageApplications ? 'applications' : 'platform';
  const [platformDirty, setPlatformDirty] = useState(false);
  const [target, setTarget] = useState<Account>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const [applications, setApplications] = useState<UserApplicationAccess[]>([]);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationBusy, setApplicationBusy] = useState<string>();
  const [configuredApp, setConfiguredApp] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectDrafts, setProjectDrafts] = useState<Record<string, string>>({});
  const targetRef=useRef(target);targetRef.current=target;
  useEffect(()=>{
    if(!target?.id)return;const controller=new AbortController();
    accessApi.account(target.id,controller.signal).then(value=>{if(!controller.signal.aborted&&targetRef.current?.id===value.id&&value.access_version>=targetRef.current.access_version){setTarget(value);}}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});
    return()=>controller.abort();
  },[target?.id,revision]);
  useEffect(() => {
    if (!target?.id || !manageApplications) { setApplications([]); return; }
    let active = true; setApplicationLoading(true);
    appsApi.listUserAccess(target.id)
      .then(value => { if (active) { setApplications(value); setProjectDrafts(Object.fromEntries(value.map(item => [item.key, item.project_names.join(', ')]))); } })
      .catch(reason => { if (active) setError((reason as Error).message); })
      .finally(() => { if (active) setApplicationLoading(false); });
    return () => { active = false; };
  }, [target?.id, revision, manageApplications]);
  const choose = (value: Account) => {
    if (busy || applicationBusy) return;
    if (target?.id === value.id) return;
    if (platformDirty && !window.confirm('Quyền Platform chưa được lưu. Bỏ thay đổi để chọn tài khoản khác?')) return;
    setPlatformDirty(false); setApplications([]); setConfiguredApp(undefined); setTarget(value); setError(''); setSuccess('');
  };
  const setAppAccess = async (application: UserApplicationAccess) => {
    if (!target || applicationBusy) return;
    setApplicationBusy(application.key); setError(''); setSuccess('');
    try {
      const result = await appsApi.setUserAccess(application.key, target.id, { enabled: !application.enabled, expected_updated_at: application.access_updated_at });
      setApplications(current => current.map(item => item.key === application.key ? result : item));
      setSuccess(result.enabled ? `Đã cấp quyền vào ${application.display_name}.` : `Đã thu hồi quyền vào ${application.display_name}.`);
      onChanged();
    } catch (reason) { setError((reason as Error).message); }
    finally { setApplicationBusy(undefined); }
  };
  const saveAppPolicy = async (application: UserApplicationAccess, changes: Partial<Pick<UserApplicationAccess, 'role_key' | 'permission_keys' | 'project_names'>>) => {
    if (!target || applicationBusy) return;
    if (!(changes.role_key !== undefined && (application.role_keys?.length || 0) > 1) && sameFields({ role_key:changes.role_key ?? application.role_key,
      permission_keys:[...(changes.permission_keys ?? application.permission_keys)].sort(),
      project_names:[...new Set(changes.project_names ?? application.project_names)].sort() },
      { role_key:application.role_key, permission_keys:[...application.permission_keys].sort(), project_names:[...application.project_names].sort() })) {
      setError(''); setSuccess('Thông tin chưa thay đổi.'); return;
    }
    setApplicationBusy(application.key); setError(''); setSuccess('');
    try {
      const result = await appsApi.setUserAccess(application.key, target.id, {
        enabled: true,
        expected_updated_at: application.access_updated_at,
        role_key: changes.role_key,
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
    <AccessAccountList selectedId={target?.id} onSelect={choose} disabled={busy || !!applicationBusy} revision={revision} />
    <section className="admin-card access-permissions-card" aria-labelledby="access-permissions-heading">
      <h2 id="access-permissions-heading">Quyền của tài khoản</h2>
      {!target ? <div className="admin-empty"><UserRound size={32} /><p>Chọn một tài khoản ở bên trái để quản lý quyền.</p></div> : <>
        <div className="access-selected-account"><div className="access-avatar">{target.full_name.charAt(0).toUpperCase()}</div><div><h3>{target.full_name}</h3><span>@{target.username}</span></div></div>
        <div className="access-section-tabs" role="tablist" aria-label="Nhóm phân quyền" onKeyDown={event => {
          if (managePlatform && manageApplications && !busy && !applicationBusy && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const next = event.key === 'Home' ? 'platform' : event.key === 'End' ? 'applications' : activeTab === 'platform' ? 'applications' : 'platform';
            setTab(next); document.getElementById(`access-tab-${next}`)?.focus();
          }
        }}>
          {managePlatform && <button id="access-tab-platform" type="button" role="tab" aria-controls="access-panel-platform" tabIndex={activeTab === 'platform' ? 0 : -1} aria-selected={activeTab === 'platform'} disabled={busy || !!applicationBusy} onClick={() => setTab('platform')}><ShieldCheck size={16}/>Platform{platformDirty && <span aria-label="Chưa lưu"> •</span>}</button>}
          {manageApplications && <button id="access-tab-applications" type="button" role="tab" aria-controls="access-panel-applications" tabIndex={activeTab === 'applications' ? 0 : -1} aria-selected={activeTab === 'applications'} disabled={busy || !!applicationBusy} onClick={() => setTab('applications')}><LayoutGrid size={16}/>Ứng dụng</button>}
        </div>
        {managePlatform && <div id="access-panel-platform" role="tabpanel" aria-labelledby="access-tab-platform" hidden={activeTab !== 'platform'}><PlatformPermissions key={target.id} target={target} revision={revision} onChanged={onChanged} onBusy={setBusy} onDirty={setPlatformDirty}/></div>}
        {manageApplications && <div id="access-panel-applications" role="tabpanel" aria-labelledby="access-tab-applications" hidden={activeTab !== 'applications'}>
        <div className="access-central-note"><strong>{applications.filter(item=>item.enabled).length}/{applications.length} ứng dụng được cấp</strong><span>Chọn vai trò và quyền nghiệp vụ cho từng ứng dụng.</span></div>
        <div className="access-permission-group"><div className="access-group-heading"><LayoutGrid size={19} /><h3>Ứng dụng doanh nghiệp</h3></div>
          {applicationLoading && <p role="status">Đang tải quyền ứng dụng…</p>}
          {!applicationLoading && !applications.length && !error && <p className="access-permission-note">Chưa có ứng dụng nào được đăng ký.</p>}
          {applications.map(application => <div className="access-application-block" key={application.key}><div className="access-application-row">
            <div><h4>{application.display_name}</h4><p>{application.description || application.key}</p>{application.enabled && application.role_display_name && <span className="access-role-badge">{application.role_display_name} · {application.permission_keys.length} quyền</span>}</div>
            <div className="access-application-actions">{application.enabled && application.roles.length > 0 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfiguredApp(current => current === application.key ? undefined : application.key)}>Cấu hình <ChevronDown size={14}/></button>}<button type="button" className={`btn btn-sm ${application.enabled ? 'btn-danger-outline' : 'btn-primary'}`} disabled={!!applicationBusy || !target.is_active} onClick={() => { void setAppAccess(application); }}>
              {applicationBusy === application.key ? 'Đang lưu…' : application.enabled ? 'Thu hồi' : 'Cấp quyền'}
            </button></div>
          </div>{application.enabled && configuredApp === application.key && application.roles.length > 0 && <div className="access-app-policy">
            <label><span>Vai trò nghiệp vụ</span><select value={(application.role_keys?.length || 0)>1?'':application.role_key || ''} disabled={!!applicationBusy} onChange={event => { const role=application.roles.find(item=>item.key===event.target.value); if(role) void saveAppPolicy(application,{role_key:role.key,permission_keys:application.key==='bookingreports'&&role.key==='admin'?application.permissions.map(permission=>permission.code):role.permission_keys}); }}>{((application.role_keys?.length || 0)>1 || !application.role_key)&&<option value="" disabled>{(application.role_keys?.length || 0)>1?'Đang giữ các vai trò hiện có':'Chưa gán vai trò'}</option>}{application.roles.map(role=><option key={role.key} value={role.key}>{role.display_name}</option>)}</select></label>
            {(application.role_keys?.length || 0)>1&&<p className="access-permission-note">Đang giữ: {application.role_display_name}. Chọn một vai trò trong danh sách để thay thế các vai trò hiện có và áp dụng bộ quyền mặc định của vai trò đó.</p>}
            <div className="access-policy-heading"><strong>Quyền được cấp</strong><span>{application.permission_keys.length}/{application.permissions.length}</span></div>
            <div className="access-permission-grid">{application.permissions.map(permission=><label key={permission.code} title={permission.code}><input type="checkbox" checked={application.permission_keys.includes(permission.code)} disabled={!!applicationBusy || (application.key==='bookingreports'&&application.role_key==='admin')} onChange={event=>{const next=event.target.checked?[...application.permission_keys,permission.code]:application.permission_keys.filter(code=>code!==permission.code);void saveAppPolicy(application,{permission_keys:next});}}/><span>{permission.display_name}</span></label>)}</div>
            {application.key==='bookingreports'&&application.role_key==='admin'?<p className="access-permission-note">Quản trị viên có toàn quyền và truy cập mọi dự án. Chọn vai trò khác để giới hạn quyền.</p>:<><label><span>Phạm vi dự án</span><textarea rows={2} value={projectDrafts[application.key] || ''} placeholder="Tên dự án, cách nhau bằng dấu phẩy" onChange={event=>setProjectDrafts(current=>({...current,[application.key]:event.target.value}))}/></label>
            <button type="button" className="btn btn-primary btn-sm access-policy-save" disabled={!!applicationBusy} onClick={()=>void saveAppPolicy(application,{project_names:(projectDrafts[application.key]||'').split(',').map(value=>value.trim()).filter(Boolean)})}><Save size={14}/>Lưu phạm vi dự án</button></>}
          </div>}{['workflows', 'itam', 'bookingreports'].includes(application.key) && <fieldset className="application-account-fieldset" disabled={!!applicationBusy}><ApplicationAccountLifecycle key={`${target.id}:${application.key}`} applicationKey={application.key} name={application.display_name} targetId={target.id} username={target.username} accessEnabled={application.enabled} revision={revision} roleNames={Object.fromEntries(application.roles.map(role=>[role.key,role.display_name]))} onChanged={onChanged} onBusy={value=>setApplicationBusy(value?application.key:undefined)}/></fieldset>}</div>)}
        </div>
        </div>}
      </>}
      {success && <p className="access-success" role="status"><CheckCircle2 size={17} />{success}</p>}
      {error && <p className="alert-error" role="alert">{error}</p>}
    </section>
  </div>
    {managePlatform && <><div className="access-history-toggle-row"><button type="button" className="btn btn-outline access-history-toggle" aria-expanded={historyOpen} aria-controls="access-history-panel" onClick={()=>setHistoryOpen(value=>!value)}><History size={16}/>{historyOpen?'Ẩn lịch sử thay đổi':'Xem lịch sử thay đổi'}{historyOpen?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button></div>
    {historyOpen&&<AccessHistory id="access-history-panel" targetId={target?.id} revision={revision}/>}</>}</>;
}

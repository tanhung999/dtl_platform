import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, Link2, Search, ShieldCheck, Unlink, X } from 'lucide-react';
import { requestWithTimeout } from '../../../services/requestTimeout';
import { createRequestId } from '../../../services/requestId';
import { ApiError } from '../../../services/api';
import './workflow-account-linking.css';

interface WorkflowAccount {
  id: string; username: string; full_name: string; email: string | null; is_active: boolean; department: string | null;
  identity_subject: string | null; updated_at: string; roles: {key: string; name: string}[];
  link_status: 'unlinked' | 'legacy_here' | 'linked_here' | 'linked_elsewhere'; preserves_local_permissions: boolean;
}
interface LinkState {
  configured: boolean; blocked_reason: string | null; auto_link_blocked: boolean;
  platform_account: {id: string; username: string; full_name: string; email: string | null; identity_subject: string};
  grant_updated_at: string | null; policy: {role_key: string | null; role_name: string | null; permission_keys: string[]} | null;
  accounts: WorkflowAccount[]; roles: {key: string; name: string}[]; permission_keys: string[];
  history: {operation_id: string; action: 'link' | 'unlink'; workflow_username: string; actor_username: string; created_at: string}[];
}
interface Candidates {items: WorkflowAccount[]; total: number; offset: number; limit: number}

export function WorkflowAccountLinker({ targetId, revision, onLinked }: {targetId: string; revision: number; onLinked: () => void}) {
  const [open, setOpen] = useState(false), [state, setState] = useState<LinkState>();
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [data, setData] = useState<Candidates>();
  const [selected, setSelected] = useState<WorkflowAccount>(), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false), [searching, setSearching] = useState(false);
  const [error, setError] = useState(''), [searchError, setSearchError] = useState(''), [success, setSuccess] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState(''), [uncertain, setUncertain] = useState(false);
  const [unlinkAccount, setUnlinkAccount] = useState<WorkflowAccount>(), [revokeAccess, setRevokeAccess] = useState(true);
  const inFlight = useRef(false), operation = useRef<string>(), mounted = useRef(true);
  const base = `/api/admin/applications/workflows/users/${encodeURIComponent(targetId)}/account-link`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setState(undefined); setSelected(undefined); setData(undefined); setError(''); operation.current = undefined;
    setUncertain(false); setUnlinkAccount(undefined); setRevokeAccess(true);
    requestWithTimeout<LinkState>(base, {signal: controller.signal, cache: 'no-store'})
      .then(value => {
        if (controller.signal.aborted) return;
        setState(value); setOffset(0);
        setQuery(value.accounts.find(a => a.link_status === 'legacy_here')?.username || value.platform_account.username);
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, base, revision, reload]);
  const linked = state?.accounts.find(a => a.link_status === 'linked_here');
  const legacy = state?.accounts.find(a => a.link_status === 'legacy_here');
  useEffect(() => {
    if (!open || !state || state.blocked_reason || linked) return;
    const controller = new AbortController();
    setSearching(true); setSearchError(''); setData(undefined);
    const timer = setTimeout(() => {
      requestWithTimeout<Candidates>(`${base}/candidates?${new URLSearchParams({q: query.trim(), offset: String(offset)})}`,
        {signal: controller.signal, cache: 'no-store'})
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(reason => { if (!controller.signal.aborted) setSearchError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, state, linked, base, query, offset]);
  const policyReady = Boolean(selected?.preserves_local_permissions || (state?.policy?.role_key
    && state.roles.some(r => r.key === state.policy?.role_key)
    && state.policy.permission_keys.every(code => state.permission_keys.includes(code))));
  const link = async () => {
    if (inFlight.current || !selected || !state || !policyReady || state.blocked_reason) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    operation.current ||= createRequestId();
    try {
      await requestWithTimeout(base, {method: 'POST', body: JSON.stringify({
        operation_id: operation.current, workflow_user_id: selected.id,
        expected_subject: selected.identity_subject, expected_updated_at: selected.updated_at,
        expected_platform_subject: state.platform_account.identity_subject, expected_grant_updated_at: state.grant_updated_at,
      })}, 25000);
      if (mounted.current) {
        setSuccess(`Đã liên kết @${selected.username} với tài khoản Platform. Hồ sơ Workflow được giữ nguyên.`);
        setReload(value => value + 1); onLinked();
      }
    } catch (reason) {
      if (mounted.current) {
        if (reason instanceof ApiError && reason.status === 409) {
          setNotice(reason.message); setReload(value => value + 1);
        } else {
          setError((reason as Error).message);
          setUncertain(!(reason instanceof ApiError) || reason.status >= 500);
        }
      }
    }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  const label = (a: WorkflowAccount) => !a.is_active ? 'Tài khoản bị khóa' : a.link_status === 'linked_elsewhere' ? 'Đã liên kết với tài khoản khác'
    : a.link_status === 'linked_here' ? 'Đã liên kết' : a.link_status === 'legacy_here' ? 'Liên kết cũ · Có thể cập nhật' : 'Chưa liên kết';
  const prepareUnlink = (account: WorkflowAccount) => {
    if (inFlight.current || uncertain) return;
    setUnlinkAccount(account); setSelected(undefined); setRevokeAccess(true); setError(''); setSuccess(''); setNotice('');
    operation.current = undefined;
  };
  const unlink = async () => {
    if (inFlight.current || !state || !unlinkAccount) return;
    inFlight.current = true; setBusy(true); setError(''); setSuccess('');
    operation.current ||= createRequestId();
    try {
      const result = await requestWithTimeout<{access_revoked: boolean}>(`${base}/unlink`, {method: 'POST', body: JSON.stringify({
        operation_id: operation.current, workflow_user_id: unlinkAccount.id,
        expected_subject: unlinkAccount.identity_subject, expected_updated_at: unlinkAccount.updated_at,
        expected_platform_subject: state.platform_account.identity_subject, expected_grant_updated_at: state.grant_updated_at,
        revoke_access: revokeAccess,
      })}, 25000);
      if (mounted.current) {
        setSuccess(`Đã hủy liên kết @${unlinkAccount.username}. ${result.access_revoked ? 'Đã thu hồi quyền mở DT Workflow.' : 'Quyền mở ứng dụng được giữ; SSO chỉ hoạt động lại sau khi liên kết lại.'}`);
        setReload(value => value + 1); onLinked();
      }
    } catch (reason) {
      if (mounted.current) {
        if (reason instanceof ApiError && reason.status === 409) {
          setNotice(reason.message); setReload(value => value + 1);
        } else {
          setError((reason as Error).message);
          setUncertain(!(reason instanceof ApiError) || reason.status >= 500);
        }
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="workflow-linking">
    <button type="button" className="btn btn-outline btn-sm" aria-expanded={open} disabled={busy}
      onClick={() => { setOpen(value => !value); setSuccess(''); }}><Link2 size={15}/>{open ? 'Ẩn liên kết tài khoản' : 'Liên kết tài khoản'}</button>
    {open && <section className="workflow-link-panel" aria-label="Liên kết tài khoản DT Workflow" aria-busy={busy || loading}>
      <header><div><h4>Liên kết tài khoản DT Workflow</h4><p>Chọn tài khoản Workflow hiện có của cùng một người.</p></div>
        <button type="button" className="task-icon-button" aria-label="Đóng liên kết tài khoản" disabled={busy} onClick={() => setOpen(false)}><X size={17}/></button></header>
      {loading && <p role="status">Đang kiểm tra liên kết…</p>}
      {state?.blocked_reason && <p className="workflow-link-note" role="note">{state.blocked_reason}</p>}
      {state?.auto_link_blocked && <p className="workflow-link-note" role="note">SSO đã được hủy liên kết và sẽ không tự kết nối lại. Quản trị viên cần chọn tài khoản và xác nhận liên kết lại.</p>}
      {notice && <p className="workflow-link-note" role="status">{notice}</p>}
      {state && (linked ? <div className="workflow-linked-account"><CheckCircle2 size={20}/>
        <div><strong>Đã liên kết: {linked.full_name}</strong><p>@{linked.username} · {linked.email || 'Chưa có email'}</p>
        <span>{linked.preserves_local_permissions ? 'Giữ quyền Workflow hiện tại theo ngoại lệ quản trị.' : 'Quyền được đồng bộ từ Platform khi đăng nhập SSO.'}</span>
        {!unlinkAccount && <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy || uncertain} onClick={() => prepareUnlink(linked)}><Unlink size={15}/>Hủy liên kết</button>}</div></div> : !state.blocked_reason && <>
        <label className="workflow-link-search"><span><Search size={15}/>Tìm tài khoản Workflow</span>
          <input className="form-input" value={query} disabled={busy || uncertain || !!unlinkAccount} maxLength={100} placeholder="Tên đăng nhập, họ tên hoặc email"
            onChange={event => { setQuery(event.target.value); setOffset(0); setSelected(undefined); operation.current = undefined; setError(''); setNotice(''); }}/></label>
        {searching && <p role="status">Đang tìm tài khoản…</p>}
        {searchError && <p className="alert-error" role="alert">{searchError}</p>}
        {!searching && data && <><div className="workflow-link-candidates" role="radiogroup" aria-label="Tài khoản Workflow phù hợp">
          {data.items.map(account => <label key={account.id} className={`workflow-link-candidate${selected?.id === account.id ? ' is-selected' : ''}`}>
            <input type="radio" name={`workflow-link-${targetId}`} checked={selected?.id === account.id}
              disabled={busy || uncertain || !!unlinkAccount || !account.is_active || account.link_status === 'linked_elsewhere' || account.link_status === 'linked_here'}
              onChange={() => { setSelected(account); operation.current = undefined; setError(''); }}/>
            <span><strong>{account.full_name}</strong><span>@{account.username} · {account.email || 'Chưa có email'}</span>
              <small>{account.department ? `${account.department} · ` : ''}{account.roles.map(r => r.name).join(', ') || 'Chưa có vai trò'}</small>
              <small>{label(account)}</small></span></label>)}
          {!data.items.length && <p>Không tìm thấy tài khoản phù hợp. Hãy thử tên đăng nhập hoặc email khác.</p>}
        </div>{data.total > data.limit && <div className="workflow-link-pagination">
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || uncertain || !!unlinkAccount || !offset} onClick={() => { setOffset(Math.max(0, offset - data.limit)); setSelected(undefined); }}>Trước</button>
          <span>{offset + 1}–{Math.min(offset + data.limit, data.total)} / {data.total}</span>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy || uncertain || !!unlinkAccount || offset + data.limit >= data.total} onClick={() => { setOffset(offset + data.limit); setSelected(undefined); }}>Sau</button>
        </div>}</>}
        {selected && <div className="workflow-link-confirm">
          <strong>Kiểm tra trước khi liên kết</strong>
          <div className="workflow-link-pair"><div><span>Platform</span><strong>{state.platform_account.full_name}</strong><small>@{state.platform_account.username} · {state.platform_account.email || 'Chưa có email'}</small></div>
            <ArrowRight size={18} aria-hidden="true"/><div><span>DT Workflow</span><strong>{selected.full_name}</strong><small>@{selected.username} · {selected.email || 'Chưa có email'}</small></div></div>
          <p><ShieldCheck size={16}/>{selected.preserves_local_permissions ? 'Tài khoản này giữ quyền Workflow hiện tại theo ngoại lệ quản trị.'
            : `Vai trò sau khi đăng nhập SSO: ${state.policy?.role_name || 'Chưa cấu hình'} · ${state.policy?.permission_keys.length || 0} quyền từ Platform.`}</p>
          {!policyReady && <p className="alert-error">Hãy cấu hình vai trò và quyền ứng dụng hợp lệ trên Platform trước khi liên kết.</p>}
          <p>Hồ sơ và lịch sử công việc được giữ nguyên. Các phiên đăng nhập Workflow cũ của tài khoản này sẽ kết thúc.</p>
          <button type="button" className="btn btn-primary" disabled={busy || !policyReady} onClick={() => { void link(); }}>
            <Link2 size={16}/>{busy ? 'Đang liên kết…' : uncertain ? 'Kiểm tra và thử lại' : 'Xác nhận liên kết'}</button>
        </div>}
      </>)}
      {!linked && legacy && !unlinkAccount && <div className="workflow-legacy-unlink"><span>Liên kết cũ: @{legacy.username}</span>
        <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy || uncertain} onClick={() => prepareUnlink(legacy)}><Unlink size={15}/>Hủy liên kết cũ</button></div>}
      {state && unlinkAccount && <div className="workflow-link-confirm" role="group" aria-label="Xác nhận hủy liên kết">
        <strong>Hủy liên kết hai tài khoản này?</strong>
        <div className="workflow-link-pair"><div><span>Platform</span><strong>{state.platform_account.full_name}</strong><small>@{state.platform_account.username}</small></div>
          <Unlink size={18} aria-hidden="true"/><div><span>DT Workflow</span><strong>{unlinkAccount.full_name}</strong><small>@{unlinkAccount.username} · {unlinkAccount.email || 'Chưa có email'}</small></div></div>
        <p>Hồ sơ, mật khẩu và dữ liệu Workflow được giữ nguyên. Các phiên đăng nhập Workflow của tài khoản này sẽ kết thúc. SSO chỉ hoạt động lại sau khi quản trị viên liên kết lại.</p>
        <label className="workflow-unlink-option"><input type="checkbox" checked={revokeAccess} disabled={busy || uncertain}
          onChange={event => { setRevokeAccess(event.target.checked); operation.current = undefined; }}/><span>Thu hồi quyền mở DT Workflow trên Platform<small>Bỏ chọn nếu bạn sẽ liên kết lại với một tài khoản Workflow khác.</small></span></label>
        <div className="workflow-unlink-actions"><button type="button" className="btn btn-outline" disabled={busy || uncertain}
          onClick={() => { setUnlinkAccount(undefined); operation.current = undefined; }}>Quay lại</button>
          <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => { void unlink(); }}>
            <Unlink size={16}/>{busy ? 'Đang hủy liên kết…' : uncertain ? 'Kiểm tra và thử lại' : 'Xác nhận hủy liên kết'}</button></div>
      </div>}
      {success && <p className="access-success" role="status"><CheckCircle2 size={16}/>{success}</p>}
      {error && <div role="alert"><p className="alert-error">{error}</p>{!state && <button type="button" className="btn btn-outline btn-sm" onClick={() => setReload(value => value + 1)}>Thử lại</button>}</div>}
      {!!state?.history.length && <details className="workflow-link-history"><summary>Lịch sử liên kết ({state.history.length})</summary>
        <ul>{state.history.map(item => <li key={item.operation_id}>{item.action === 'unlink' ? 'Hủy liên kết' : 'Liên kết'} @{item.workflow_username} · Người thực hiện: @{item.actor_username} · {new Date(item.created_at).toLocaleString('vi-VN', {timeZone: 'Asia/Ho_Chi_Minh'})}</li>)}</ul></details>}
    </section>}
  </div>;
}

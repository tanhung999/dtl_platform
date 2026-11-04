import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, Search, ShieldCheck } from 'lucide-react';
import { requestWithTimeout } from '../../../services/requestTimeout';
import { createRequestId } from '../../../services/requestId';
import { ApiError } from '../../../services/api';
import './workflow-account-linking.css';

interface Snapshot {
  account: { id: string; username: string; full_name: string; email: string | null; identity_subject: string | null; is_active: boolean };
  role_keys: string[]; permission_keys: string[]; project_names: string[]; revision: string;
}
interface Candidates { items: Snapshot[]; has_more: boolean; platform_subject: string; grant_updated_at: string }
export function ApplicationPolicyLinker({ applicationKey, name, targetId, username, linked, roleNames, onLinked, onBusy }: {
  applicationKey: string; name: string; targetId: string; username: string; linked: boolean;
  roleNames: Record<string, string>; onLinked: () => void; onBusy?: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(username), [offset, setOffset] = useState(0);
  const [data, setData] = useState<Candidates>(), [selected, setSelected] = useState<Snapshot>();
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const operation = useRef<string>(), inFlight = useRef(false), mounted = useRef(true);
  const base = `/api/admin/applications/${encodeURIComponent(applicationKey)}/users/${encodeURIComponent(targetId)}/policy-link`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open || linked || uncertain || busy) return;
    const controller = new AbortController();
    setLoading(true); setError(''); setData(undefined); setSelected(undefined);
    const timer = setTimeout(() => {
      requestWithTimeout<Candidates>(`${base}/candidates?${new URLSearchParams({ q: query, offset: String(offset) })}`, { signal: controller.signal, cache: 'no-store' })
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(reason => { if (!controller.signal.aborted) setError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, linked, query, offset, base]);
  const confirm = async () => {
    if (!selected || !data || inFlight.current) return;
    operation.current ||= createRequestId();
    inFlight.current = true; setBusy(true); onBusy?.(true); setError('');
    try {
      await requestWithTimeout(base, { method: 'POST', body: JSON.stringify({ operation_id: operation.current,
        external_user_id: selected.account.id, expected_revision: selected.revision,
        expected_platform_subject: data.platform_subject, expected_grant_updated_at: data.grant_updated_at }) }, 25000);
      if (mounted.current) { setUncertain(false); setSuccess('Đã liên kết và lấy toàn bộ quyền hiện tại về Platform. Từ nay chỉnh quyền tại Platform.'); onLinked(); }
    } catch (reason) {
      if (mounted.current) {
        setError((reason as Error).message);
        // Even a validation error can follow a successful remote commit; retain the same operation for recovery.
        setUncertain(true);
        if (reason instanceof ApiError && reason.status === 409) setError(`${reason.message} Nếu cần đồng bộ danh mục, hoàn tất rồi thử lại cùng thao tác này.`);
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); onBusy?.(false); }
  };
  if (linked) return <p className="access-success"><ShieldCheck size={16}/>Đã liên kết · Quyền được quản lý tại Platform</p>;
  return <section className="workflow-linking">
    <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setOpen(value => !value)}><Link2 size={15}/>{open ? 'Thu gọn liên kết' : 'Liên kết tài khoản có sẵn'}</button>
    {open && <div className="workflow-link-panel">
      <p>Chọn đúng tài khoản tại {name}. Quyền hiện tại của tài khoản đó sẽ được lấy về Platform; dữ liệu nghiệp vụ được giữ nguyên.</p>
      <label className="workflow-link-search"><span><Search size={15}/>Tìm tài khoản {name}</span>
        <input className="form-input" value={query} maxLength={100} disabled={busy || uncertain} placeholder="Tên đăng nhập hoặc email"
          onChange={event => { setQuery(event.target.value); setOffset(0); operation.current = undefined; }}/></label>
      {loading && <p role="status">Đang tìm tài khoản…</p>}
      <div className="workflow-link-candidates" role="radiogroup" aria-label={`Tài khoản ${name}`}>
        {data?.items.map(item => {
          const boundElsewhere = item.account.identity_subject && ![data.platform_subject, `platform:${targetId}`].includes(item.account.identity_subject);
          return <label key={item.account.id} className={`workflow-link-candidate${selected?.account.id === item.account.id ? ' is-selected' : ''}`}>
            <input type="radio" name={`${applicationKey}-policy-link`} checked={selected?.account.id === item.account.id}
              disabled={busy || uncertain || !item.account.is_active || !!boundElsewhere}
              onChange={() => { setSelected(item); operation.current = undefined; }}/>
            <span><strong>{item.account.full_name || item.account.username}</strong><span>@{item.account.username} · {item.account.email || 'Chưa có email'}</span>
              <small>{item.role_keys.map(key => roleNames[key] || key).join(', ') || 'Chưa có vai trò'} · {item.permission_keys.length} quyền</small>
              {boundElsewhere && <small>Đã liên kết với tài khoản khác</small>}{!item.account.is_active && <small>Tài khoản đã bị khóa</small>}</span>
          </label>;
        })}
      </div>
      {data && !loading && !data.items.length && <p>Không tìm thấy tài khoản phù hợp.</p>}
      {data && <div className="workflow-link-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={!offset || busy || uncertain} onClick={() => setOffset(value => Math.max(0, value - 20))}>Trước</button>
        <button type="button" className="btn btn-outline btn-sm" disabled={!data.has_more || busy || uncertain} onClick={() => setOffset(value => value + 20)}>Sau</button></div>}
      {selected && <div className="workflow-link-confirm"><strong>Liên kết @{username} với @{selected.account.username}?</strong>
        <p>Giữ nguyên {selected.permission_keys.length} quyền hiện tại{selected.project_names.length ? ` và ${selected.project_names.length} dự án` : ''}, kể cả các quyền đã bị chặn. Sau khi liên kết, website đích chỉ hiển thị quyền; mọi chỉnh sửa thực hiện tại Platform.</p>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void confirm(); }}><Link2 size={16}/>{busy ? 'Đang liên kết…' : uncertain ? 'Thử lại cùng thao tác' : 'Xác nhận liên kết và nhập quyền'}</button></div>}
      {error && <p className="alert-error" role="alert">{error}</p>}
      {success && <p className="access-success" role="status"><CheckCircle2 size={16}/>{success}</p>}
    </div>}
  </section>;
}

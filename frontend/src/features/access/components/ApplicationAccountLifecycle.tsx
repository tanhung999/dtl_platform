import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Link2, RefreshCw, Unlink } from 'lucide-react';
import { requestWithTimeout } from '../../../services/requestTimeout';
import { createRequestId } from '../../../services/requestId';
import { ApplicationPolicyLinker } from './ApplicationPolicyLinker';
import './application-account-lifecycle.css';

interface Status {
  configured: boolean; state: string; enabled: boolean; version: number; can_enable: boolean;
  managed_by_platform: boolean; pending_enabled: boolean | null; blocked_reason?: string; revision?: string;
  account?: { id: string; username: string; email?: string; is_active: boolean };
  pending_unlink?: { operation_id: string; external_user_id: string; expected_revision: string };
}
export function ApplicationAccountLifecycle({ applicationKey, name, targetId, username, accessEnabled, revision, roleNames, onChanged, onBusy }: {
  applicationKey: string; name: string; targetId: string; username: string; accessEnabled: boolean; revision: number;
  roleNames: Record<string, string>; onChanged: () => void; onBusy: (busy: boolean) => void;
}) {
  const [data, setData] = useState<Status>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [confirmUnlink, setConfirmUnlink] = useState(false);
  const flight = useRef(false), mounted = useRef(true);
  const base = `/api/admin/applications/${encodeURIComponent(applicationKey)}/users/${encodeURIComponent(targetId)}/provisioning`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try { const value = await requestWithTimeout<Status>(base, { cache: 'no-store', signal }); if (!signal?.aborted && mounted.current) setData(value); }
    catch (reason) { if (!signal?.aborted && mounted.current) setError((reason as Error).message); }
    finally { if (!signal?.aborted && mounted.current) setLoading(false); }
  }, [base]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load, revision]);
  const change = async (enabled: boolean) => {
    if (!data || flight.current) return;
    flight.current = true; setBusy(true); onBusy(true); setError('');
    try {
      const value = await requestWithTimeout<Status>(base, { method: 'PUT', body: JSON.stringify({ enabled, expected_version: data.version }) }, 25000);
      if (mounted.current) { setData(value); onChanged(); }
    } catch (reason) { if (mounted.current) { setError((reason as Error).message); await load(); } }
    finally { flight.current = false; if (mounted.current) setBusy(false); onBusy(false); }
  };
  const unlink = async () => {
    if (!data || flight.current || (!data.pending_unlink && (!data.account || !data.revision))) return;
    flight.current = true; setBusy(true); onBusy(true); setError('');
    const payload = data.pending_unlink || { operation_id: createRequestId(), external_user_id: data.account!.id, expected_revision: data.revision! };
    try {
      await requestWithTimeout(base + '/unlink', { method: 'POST', body: JSON.stringify({ ...payload, expected_version: data.version }) }, 25000);
      if (mounted.current) { setConfirmUnlink(false); onChanged(); await load(); }
    } catch (reason) { if (mounted.current) { setError((reason as Error).message); await load(); } }
    finally { flight.current = false; if (mounted.current) setBusy(false); onBusy(false); }
  };
  const linked = !!data?.account;
  return <section className="application-account-lifecycle" aria-label={`Tài khoản ${name}`}>
    <div className="application-account-heading"><strong><Link2 size={16}/>Tài khoản tại {name}</strong><button type="button" className="btn btn-outline btn-sm" disabled={busy || loading} aria-label="Tải lại trạng thái tài khoản" onClick={() => { setError(''); void load(); }}><RefreshCw size={14}/></button></div>
    {loading && !data && <p role="status">Đang kiểm tra tài khoản…</p>}
    {data?.configured === false && <p>{data.blocked_reason}</p>}
    {busy && <p role="status">Đang chờ website đích xác nhận…</p>}
    {data?.configured && <>
      {linked ? <div className="application-bound-account"><div><strong>{data.state === 'legacy' ? 'Đang dùng mã liên kết cũ' : 'Đã liên kết'} · @{data.account!.username}</strong><p>{data.account!.email}{!data.account!.is_active && ' · Tài khoản đã khóa'}</p></div>
        <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => setConfirmUnlink(value => !value)}><Unlink size={14}/>Hủy liên kết</button></div>
      : <label className="application-create-option"><input type="checkbox" role="switch" checked={data.pending_enabled ?? data.enabled}
          disabled={busy || loading || !!data.pending_unlink || (!data.enabled && data.pending_enabled !== true && !data.can_enable)}
          onChange={event => { void change(event.target.checked); }}/><span><strong>Cho phép tạo tài khoản khi đăng nhập lần đầu</strong><small>Chỉ áp dụng cho tài khoản này tại {name}. Không tự ghép với tài khoản có sẵn.</small></span></label>}
      {data.blocked_reason && <p className="application-account-warning"><AlertCircle size={15}/>{data.blocked_reason}</p>}
      {!linked && !accessEnabled && <p>Cấp quyền truy cập ứng dụng trước khi cho phép tự tạo.</p>}
      {data.pending_enabled !== null && !data.pending_unlink && <div className="application-account-warning"><span>Đang chờ xác nhận {data.pending_enabled ? 'bật' : 'tắt'} tự tạo từ website đích.</span><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { void change(data.pending_enabled!); }}>Thử lại</button></div>}
      {(confirmUnlink || data.pending_unlink) && <div className="application-unlink-confirm"><strong>Hủy liên kết với {name}?</strong><p>Giữ nguyên tài khoản và dữ liệu tại website đích. Thu hồi quyền truy cập từ Platform và tắt tự tạo tài khoản.</p>
        <div><button type="button" className="btn btn-outline btn-sm" disabled={busy || !!data.pending_unlink} onClick={() => setConfirmUnlink(false)}>Giữ liên kết</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => { void unlink(); }}>{busy ? 'Đang xử lý…' : data.pending_unlink ? 'Tiếp tục hủy liên kết' : 'Xác nhận hủy liên kết'}</button></div></div>}
      {!data.pending_unlink && !data.managed_by_platform && <ApplicationPolicyLinker applicationKey={applicationKey} name={name} targetId={targetId} username={username} linked={false} roleNames={roleNames} onLinked={() => { onChanged(); void load(); }} onBusy={onBusy}/>}
    </>}
    {error && <p className="alert-error" role="alert">{error}</p>}
  </section>;
}

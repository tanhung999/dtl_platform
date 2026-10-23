import { ReactNode, useEffect, useRef, useState } from 'react';
import { Users, X } from 'lucide-react';
import { Scope, Share, ShareState, sharingApi } from './api';
import { Account } from '../access/api';
import { useMutationChecking } from '../mutations/useMutationChecking';
import { ApiError } from '../../services/api';
import { AccountSearch } from '../access/AccountSearch';
import { sameFields } from '../../services/unchanged';
export function SharingDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const node = ref.current; node?.showModal(); return () => { node?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="calendar-event-dialog calendar-sharing-dialog" aria-label={title}
    onCancel={e => { e.preventDefault(); e.stopPropagation(); }}>
    <header className="calendar-dialog-header"><h2>{title}</h2><button type="button" className="calendar-icon-button" aria-label="Đóng" onClick={onClose}><X size={20} /></button></header>{children}</dialog>;
}
export function ScopeFields({ value, onChange, disabled }: { value: Scope; onChange: (value: Scope) => void; disabled?: boolean }) {
  return <div className="sharing-scopes">{([['share_events', 'Sự kiện', 'Ẩn hoàn toàn các sự kiện riêng tư.'], ['share_tasks', 'Công việc', 'Chỉ hiển thị công việc có hạn; người được chia sẻ chỉ được xem.'], ['share_notes', 'Ghi chú', 'Chia sẻ ghi chú đã gắn vào lịch và nội dung bên trong; ghi chú riêng tư được ẩn.']] as const).map(([key, label, hint]) => <label key={key}><input type="checkbox" disabled={disabled} checked={value[key]} onChange={e => onChange({ ...value, [key]: e.target.checked })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div>;
}
export function ManageSharing({ userId, onClose, onChanged, revision }: { revision: number; userId: string; onClose: () => void; onChanged: () => void }) {
  const checking=useMutationChecking();
  const [rows, setRows] = useState<Share[]>([]), [target, setTarget] = useState<Account>(), [editing, setEditing] = useState<ShareState>();
  const [scope, setScope] = useState<Scope>({ share_events: true, share_tasks: false, share_notes: false }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [removing, setRemoving] = useState<Share>();
  useEffect(() => { const c = new AbortController(); sharingApi.mine(c.signal).then(value => { if(!c.signal.aborted){setRows(value);setLoaded(true);} }).catch(e => { if (!c.signal.aborted) setError(e.message); }); return () => c.abort(); }, [revision]);
  const refresh = async () => { setRows(await sharingApi.mine()); onChanged(); };
  const choose = async (account: Account) => {
    if(busy)return;
    setBusy(true);setError('');setTarget(undefined);
    try { const state=await sharingApi.state(account.id);setTarget(account);setEditing(state);setScope(state.active?state:{share_events:true,share_tasks:false,share_notes:false}); }
    catch(reason){setError((reason as Error).message);}
    finally{setBusy(false);}
  };
  const save = async () => {
    if(!target||!editing||busy)return;
    if(editing.active && sameFields(scope, { ...editing })) { setTarget(undefined); setEditing(undefined); return; }
    setBusy(true);setError('');
    try { await sharingApi.save(target.id,scope,editing.version,editing.id??undefined);await refresh();setTarget(undefined);setEditing(undefined); }
    catch(reason){
      setError((reason as Error).message);
      if(reason instanceof ApiError && reason.status===409){
        try{const state=await sharingApi.state(target.id);setEditing(state);setScope(state);await refresh();}catch{/* Keep the original error; retry remains available. */}
      }
    }finally{setBusy(false);}
  };
  const revoke = async () => { if (!removing || busy) return; setBusy(true); setError(''); try { await sharingApi.revoke(removing); await refresh(); setRemoving(undefined); } catch(e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <SharingDialog title="Chia sẻ lịch" onClose={onClose}><div className="sharing-dialog-body"><p className="sharing-explainer"><Users size={19} /> Chọn người xem và những mục muốn chia sẻ. Người nhận chỉ có quyền xem.</p>
    {loaded && <AccountSearch selfId={userId} disabled={busy} onSelect={account=>{void choose(account);}} />}
    {busy&&!target&&<p role="status">Đang kiểm tra quyền chia sẻ…</p>}
    {target && <section className="sharing-editor"><h3>{editing?.active ? 'Sửa phạm vi' : 'Thêm người xem'} · {target.full_name}</h3><ScopeFields value={scope} onChange={setScope} disabled={busy} /><div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setTarget(undefined)} disabled={busy}>Hủy chọn</button><button type="button" className="btn btn-primary btn-sm" disabled={busy || !Object.values(scope).some(Boolean)} onClick={save}>{busy ? 'Đang lưu…' : editing?.active ? 'Lưu thay đổi' : 'Chia sẻ'}</button></div></section>}
    <h3 className="sharing-list-title">Người có quyền xem lịch ({rows.length})</h3>{!loaded && !error && <p>Đang tải…</p>}{loaded && !rows.length && <p className="calendar-muted">Bạn chưa chia sẻ lịch với ai.</p>}
    {rows.map(row => <div className="sharing-person" key={row.id}><div><strong>{row.name}</strong><small>@{row.username} · Chỉ xem</small><div className="sharing-scope-chips">{row.share_events && <span>Sự kiện</span>}{row.share_tasks && <span>Công việc</span>}{row.share_notes && <span>Ghi chú</span>}</div></div><div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { void choose({ id: row.viewer_id, full_name: row.name, username: row.username, can_share: false, access_version: 0, is_active: true }); }}>Sửa</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => setRemoving(row)}>Thu hồi</button></div></div>)}
    {removing && <div className="calendar-delete-confirm"><p>Thu hồi quyền xem lịch của {removing.name}?</p><div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setRemoving(undefined)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={revoke}>Thu hồi quyền xem</button></div></div>}
    {checking&&busy&&<p role="status">Đang kiểm tra lại kết quả…</p>}
    {error && <p className="calendar-error-state" role="alert">{error}</p>}</div></SharingDialog>;
}

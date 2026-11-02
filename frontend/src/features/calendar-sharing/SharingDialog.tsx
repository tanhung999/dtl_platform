import { ReactNode, useEffect, useRef, useState } from 'react';
import { Eye, Pencil, UserRoundMinus, Users, X } from 'lucide-react';
import { Scope, Share, ShareState, sharingApi } from './api';
import { Account } from '../access/api';
import { useMutationChecking } from '../mutations/useMutationChecking';
import { ApiError } from '../../services/api';
import { AccountSearch } from '../access/AccountSearch';
import { sameFields } from '../../services/unchanged';
import { useDialogDismiss } from '../../components/useDialogDismiss';
export function SharingDialog({ title, children, onClose, dismissOnBackdrop = false }: { title: string; children: ReactNode; onClose: () => void; dismissOnBackdrop?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const dismiss = useDialogDismiss(onClose, dismissOnBackdrop);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; const node = ref.current; node?.showModal(); return () => { node?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className="calendar-event-dialog calendar-sharing-dialog" aria-label={title}
    {...dismiss}>
    <header className="calendar-dialog-header"><h2>{title}</h2><button type="button" className="calendar-icon-button" aria-label="Đóng" onClick={onClose}><X size={20} /></button></header>{children}</dialog>;
}
export function ScopeFields({ value, onChange, disabled }: { value: Scope; onChange: (value: Scope) => void; disabled?: boolean }) {
  return <div className="sharing-scopes">{([['share_events', 'Sự kiện', 'Ẩn hoàn toàn các sự kiện riêng tư.'], ['share_tasks', 'Công việc', 'Chỉ hiển thị công việc có hạn; người được chia sẻ chỉ được xem.'], ['share_notes', 'Ghi chú', 'Chia sẻ ghi chú đã gắn vào lịch và nội dung bên trong; ghi chú riêng tư được ẩn.']] as const).map(([key, label, hint]) => <label key={key}><input type="checkbox" disabled={disabled} checked={value[key]} onChange={e => onChange({ ...value, [key]: e.target.checked })} /><span><strong>{label}</strong><small>{hint}</small></span></label>)}</div>;
}
export function ManageSharing({ userId, onClose, onChanged, revision }: { revision: number; userId: string; onClose: () => void; onChanged: () => void }) {
  const checking=useMutationChecking();
  const [viewerPage, setViewerPage] = useState(0);
  const [rows, setRows] = useState<Share[]>([]), [target, setTarget] = useState<Account>(), [editing, setEditing] = useState<ShareState>();
  const [scope, setScope] = useState<Scope>({ share_events: true, share_tasks: false, share_notes: false }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [removing, setRemoving] = useState<Share>();
  useEffect(() => { setViewerPage(page => Math.min(page, Math.max(0, Math.ceil(rows.length / 25) - 1))); }, [rows.length]);
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
  return <SharingDialog title="Chia sẻ lịch" onClose={onClose}><div className="sharing-dialog-body manage-sharing-body">
    <div className="sharing-mode"><span className="sharing-mode-icon"><Eye size={19} aria-hidden="true" /></span><div><strong>Người nhận chỉ có quyền xem</strong><p>Chọn người và nội dung bạn muốn chia sẻ.</p></div></div>
    {loaded && <AccountSearch selfId={userId} disabled={busy} onSelect={account=>{void choose(account);}} />}
    {busy&&!target&&<p role="status">Đang kiểm tra quyền chia sẻ…</p>}
    {target && <section className="sharing-editor"><h3>{editing?.active ? 'Sửa nội dung chia sẻ' : 'Thêm người xem'} · {target.full_name}</h3><ScopeFields value={scope} onChange={setScope} disabled={busy} />
      {!editing?.active && rows.length >= 500 && <p role="alert">Không thể chia sẻ thêm. Hãy thu hồi một chia sẻ trước khi thêm người khác.</p>}
      <div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setTarget(undefined)} disabled={busy}>Hủy chọn</button><button type="button" className="btn btn-primary btn-sm" disabled={busy || !Object.values(scope).some(Boolean) || !editing?.active && rows.length >= 500} onClick={save}>{busy ? 'Đang lưu…' : editing?.active ? 'Lưu thay đổi' : 'Chia sẻ'}</button></div></section>}
    <section className="sharing-viewers" aria-label="Người có quyền xem lịch"><div className="sharing-viewers-heading"><h3><Users size={16} aria-hidden="true" />Người có quyền xem lịch</h3><span>{rows.length}</span></div>
    {!loaded && !error && <p role="status" className="calendar-muted">Đang tải người xem…</p>}{loaded && !rows.length && <p className="sharing-empty">Chưa có người xem. Tìm tài khoản ở trên để bắt đầu chia sẻ.</p>}
    <div className="sharing-viewer-list">{rows.slice(viewerPage * 25, viewerPage * 25 + 25).map(row => <div className="sharing-person" key={row.id}>
      <span className="sharing-person-avatar" aria-hidden="true">{row.name.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toLocaleUpperCase('vi')}</span>
      <div className="sharing-person-info"><strong>{row.name}</strong><small>@{row.username}</small><div className="sharing-scope-chips">{row.share_events && <span>Sự kiện</span>}{row.share_tasks && <span>Công việc</span>}{row.share_notes && <span>Ghi chú</span>}</div></div>
      <div className="calendar-inline-actions sharing-person-actions"><button type="button" className="btn btn-outline btn-sm" aria-label={`Sửa quyền xem của ${row.name}`} disabled={busy} onClick={() => { void choose({ id: row.viewer_id, full_name: row.name, username: row.username, can_share: false, access_version: 0, is_active: true }); }}><Pencil size={13} aria-hidden="true" />Sửa</button><button type="button" className="btn btn-danger-outline btn-sm" aria-label={`Thu hồi quyền xem của ${row.name}`} disabled={busy} onClick={() => setRemoving(row)}><UserRoundMinus size={14} aria-hidden="true" />Thu hồi</button></div>
    </div>)}</div>
    {rows.length > 25 && <div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" disabled={!viewerPage || busy} onClick={() => setViewerPage(p => p - 1)}>Trước</button><span>{viewerPage * 25 + 1}–{Math.min(rows.length, viewerPage * 25 + 25)} / {rows.length}</span><button type="button" className="btn btn-outline btn-sm" disabled={(viewerPage + 1) * 25 >= rows.length || busy} onClick={() => setViewerPage(p => p + 1)}>Sau</button></div>}
    </section>
    <details className="sharing-content-help"><summary>Nội dung nào được hiển thị?</summary><p>Các mục bạn được giao hoặc thêm theo dõi chỉ hiển thị khi người tạo cho phép. Lịch người khác chia sẻ cho bạn không được chuyển tiếp.</p></details>
    {removing && <div className="calendar-delete-confirm"><p>Thu hồi quyền xem lịch của {removing.name}?</p><div className="calendar-inline-actions"><button type="button" className="btn btn-outline btn-sm" onClick={() => setRemoving(undefined)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={revoke}>Thu hồi quyền xem</button></div></div>}
    {checking&&busy&&<p role="status">Đang kiểm tra lại kết quả…</p>}
    {error && <p className="calendar-error-state" role="alert">{error}</p>}</div></SharingDialog>;
}

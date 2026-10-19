import { useEffect, useRef, useState } from 'react';
import { CalendarDays, CheckCircle2, UserRound } from 'lucide-react';
import { accessApi, Account } from './api';
import { AccessAccountList } from './components/AccessAccountList';
import { AccessHistory } from './components/AccessHistory';
import { useMutationChecking } from '../mutations/useMutationChecking';
import { ApiError } from '../../services/api';

export function AccessManagement({ onChanged, revision }: { onChanged: () => void; revision: number }) {
  const checking=useMutationChecking();
  const [target, setTarget] = useState<Account>();
  const [busy, setBusy] = useState(false), [confirmRevoke, setConfirmRevoke] = useState(false);
  const [error, setError] = useState(''), [success, setSuccess] = useState('');
  const targetRef=useRef(target);targetRef.current=target;
  useEffect(()=>{
    if(!target?.id)return;const controller=new AbortController();
    accessApi.account(target.id,controller.signal).then(value=>{if(!controller.signal.aborted&&targetRef.current?.id===value.id&&value.access_version>=targetRef.current.access_version){if(targetRef.current.access_version!==value.access_version)setConfirmRevoke(false);setTarget(value);}}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);});
    return()=>controller.abort();
  },[target?.id,revision]);
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
  return <><div className="access-management">
    <AccessAccountList selectedId={target?.id} onSelect={choose} disabled={busy} revision={revision} />
    <section className="admin-card access-permissions-card" aria-labelledby="access-permissions-heading">
      <h2 id="access-permissions-heading">Quyền của tài khoản</h2>
      {!target ? <div className="admin-empty"><UserRound size={32} /><p>Chọn một tài khoản ở bên trái để quản lý quyền.</p></div> : <>
        <div className="access-selected-account"><div className="access-avatar">{target.full_name.charAt(0).toUpperCase()}</div><div><h3>{target.full_name}</h3><span>@{target.username}</span></div></div>
        <div className="access-permission-group"><div className="access-group-heading"><CalendarDays size={19} /><h3>Lịch cá nhân</h3></div>
          <div className="access-permission-row"><div><h4>Chia sẻ lịch cá nhân</h4><p>Cho phép tài khoản chọn người được xem lịch và phạm vi Sự kiện, Việc cần làm, Ghi chú.</p></div><span className={`access-status ${target.can_share ? 'is-enabled' : ''}`}>{target.can_share ? 'Đã cấp' : 'Chưa cấp'}</span></div>
          <p className="access-permission-note">Quyền này áp dụng cho lịch của chính tài khoản, không cho phép xem lịch của người khác.</p>
          {confirmRevoke ? <div className="access-revoke-confirm" role="alert"><strong>Thu hồi quyền chia sẻ lịch?</strong><p>Tất cả người đang được tài khoản này chia sẻ lịch cũng sẽ mất quyền xem. Cấp lại không tự khôi phục các quyền xem cũ.</p><div className="access-actions"><button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setConfirmRevoke(false)}>Giữ lại</button><button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={save}>{busy ? 'Đang thu hồi…' : 'Xác nhận thu hồi'}</button></div></div> : <button type="button" className={`btn btn-sm ${target.can_share ? 'btn-danger-outline' : 'btn-primary'}`} disabled={busy||!target.is_active} onClick={() => target.can_share ? setConfirmRevoke(true) : save()}>{busy ? 'Đang lưu…' : target.can_share ? 'Thu hồi quyền chia sẻ' : 'Cho phép chia sẻ lịch'}</button>}
        </div>
      </>}
      {success && <p className="access-success" role="status"><CheckCircle2 size={17} />{success}</p>}
      {checking&&busy&&<p role="status">Đang kiểm tra lại kết quả…</p>}
      {error && <p className="alert-error" role="alert">{error}</p>}
    </section>
  </div><AccessHistory targetId={target?.id} revision={revision}/></>;
}

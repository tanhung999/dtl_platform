import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Account, AccountPage, accessApi } from '../api';

export function AccessAccountList({ selectedId, onSelect, disabled, revision }: {
  selectedId?:string; onSelect:(account:Account)=>void; disabled:boolean; revision:number;
}) {
  const [q,setQ]=useState(''),[filter,setFilter]=useState('all'),[page,setPage]=useState(1);
  const [saved,setSaved]=useState<{key:string;page:AccountPage}>(),[pending,setPending]=useState(false),[error,setError]=useState('');
  const [retry,setRetry]=useState(0),key=`${q.trim()}:${filter}:${page}`;
  useEffect(()=>{
    if(q.trim().length===1){setPending(false);return;}
    const controller=new AbortController();setPending(true);setError('');
    const timer=setTimeout(()=>accessApi.list(q,filter,page,controller.signal).then(value=>{if(!controller.signal.aborted)setSaved({key,page:value});}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setPending(false);}),q.trim()?300:0);
    return()=>{clearTimeout(timer);controller.abort();};
  },[key,revision,retry]);
  const data=saved?.key===key?saved.page:undefined;
  return <section className="admin-card access-account-card" aria-labelledby="access-account-heading"><h2 id="access-account-heading">Tài khoản</h2>
    <label className="calendar-field"><span><Search size={14}/> Tìm tài khoản</span><input className="form-input" disabled={disabled} maxLength={100} value={q} onChange={e=>{setQ(e.target.value);setPage(1);}} placeholder="Nhập ít nhất 2 ký tự tên hoặc tài khoản"/></label>
    <label className="access-filter"><span>Quyền chia sẻ lịch</span><select className="form-input" disabled={disabled} aria-label="Lọc quyền chia sẻ lịch" value={filter} onChange={e=>{setFilter(e.target.value);setPage(1);}}><option value="all">Tất cả tài khoản</option><option value="enabled">Đã được cấp</option><option value="disabled">Chưa được cấp</option></select></label>
    {q.trim().length===1?<p className="access-hint">Nhập ít nhất 2 ký tự để tìm kiếm.</p>:<>
      <div className="access-list-summary" role="status">{data?`${data.total} tài khoản`:pending?'Đang tải…':''}{pending&&data&&<span> · Đang cập nhật…</span>}</div>
      {error&&<div role="alert" className="alert-error"><p>{error}</p><button type="button" className="btn btn-outline btn-sm" onClick={()=>setRetry(value=>value+1)}>Thử lại</button></div>}
      <div className="sharing-account-results access-account-list" aria-busy={pending}>{data?.items.map(account=><button type="button" key={account.id} disabled={disabled} aria-pressed={selectedId===account.id} className={selectedId===account.id?'is-selected':''} onClick={()=>onSelect(account)}>
        <span className="access-account-identity"><strong>{account.full_name}</strong><small>@{account.username}</small></span><span className={`access-status ${account.can_share?'is-enabled':''}`}>{!account.is_active?'Đã dừng':account.can_share?'Đã cấp':'Chưa cấp'}</span>
      </button>)}</div>
      {data&&!data.items.length&&<p className="access-hint">Không tìm thấy tài khoản phù hợp.</p>}
      {data&&(page>1||data.has_more)&&<div className="access-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={disabled||pending||page===1} onClick={()=>setPage(value=>value-1)}>Trước</button><span>Trang {page}</span><button type="button" className="btn btn-outline btn-sm" disabled={disabled||pending||!data.has_more} onClick={()=>setPage(value=>value+1)}>Sau</button></div>}
    </>}
  </section>;
}

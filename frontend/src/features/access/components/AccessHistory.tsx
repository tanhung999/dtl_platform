import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { accessApi, AuditPage } from '../api';
const labels:Record<string,string>={sharing_capability_granted:'Cấp quyền chia sẻ lịch',sharing_capability_revoked:'Thu hồi quyền chia sẻ lịch',calendar_shared:'Chia sẻ lịch cho người xem',calendar_scope_changed:'Đổi phạm vi xem lịch',calendar_revoked:'Thu hồi quyền xem lịch'};
function scope(value:unknown) {
  if(!value||typeof value!=='object')return '';
  const flags=value as Record<string,boolean>;
  return [flags.share_events?'Sự kiện':'',flags.share_tasks?'Việc cần làm':'',flags.share_notes?'Ghi chú':''].filter(Boolean).join(', ');
}
export function AccessHistory({ targetId, revision }: {targetId?:string;revision:number}) {
  const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]),[index,setIndex]=useState(0),[data,setData]=useState<AuditPage>(),[error,setError]=useState(''),[pending,setPending]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{setCursors([undefined]);setIndex(0);setData(undefined);},[targetId,revision]);
  const cursor=cursors[index];
  useEffect(()=>{
    const controller=new AbortController();setPending(true);setError('');
    accessApi.history(targetId,cursor,controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(reason=>{if(!controller.signal.aborted)setError(reason.message);}).finally(()=>{if(!controller.signal.aborted)setPending(false);});
    return()=>controller.abort();
  },[targetId,revision,cursor,retry]);
  return <section className="admin-card access-history"><h2><History size={17}/> Lịch sử thay đổi{targetId?' của tài khoản':''}</h2>{pending&&<p role="status">Đang cập nhật lịch sử…</p>}{error&&<div role="alert"><p>{error}</p><button type="button" className="btn btn-outline btn-sm" onClick={()=>setRetry(value=>value+1)}>Thử lại</button></div>}
    {!pending&&!error&&!data?.items.length&&<p>Chưa có thay đổi được ghi nhận.</p>}
    <ol>{data?.items.map(entry=><li key={entry.id}><div><strong>{labels[entry.action]??'Thay đổi quyền'}</strong><time dateTime={entry.created_at}>{new Intl.DateTimeFormat('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Ho_Chi_Minh',hourCycle:'h23'}).format(new Date(entry.created_at))}</time></div><p>{entry.actor_name} <span>(@{entry.actor_username})</span> → {entry.subject_name} <span>(@{entry.subject_username})</span></p>{scope(entry.changes.after)&&<small>Phạm vi: {scope(entry.changes.after)}</small>}</li>)}</ol>
    {(index>0||data?.next_cursor)&&<div className="access-pagination"><button type="button" className="btn btn-outline btn-sm" disabled={pending||index===0} onClick={()=>setIndex(value=>value-1)}>Mới hơn</button><span>Trang {index+1}</span><button type="button" className="btn btn-outline btn-sm" disabled={pending||!data?.next_cursor} onClick={()=>{setCursors(values=>[...values.slice(0,index+1),data!.next_cursor!]);setIndex(value=>value+1);}}>Cũ hơn</button></div>}
  </section>;
}

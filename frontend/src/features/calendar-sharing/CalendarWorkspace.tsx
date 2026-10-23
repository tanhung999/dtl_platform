import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Eye, Share2 } from 'lucide-react';
import { CalendarPage } from '../calendar/CalendarPage';
import { WORKSPACE_CHANGED } from '../realtime/useWorkspaceRealtime';
import { useInvalidation } from '../realtime/useInvalidation';
import { Share, sharingApi } from './api';
import { Capabilities, accessApi } from '../access/api';
import { ManageSharing } from './SharingDialog';
import { SharedCalendarView } from './SharedCalendarView';
import './calendar-sharing.css';
export function CalendarWorkspace({ userId, userName, initialDate, initialOwner, onDateChange, onOwnerChange }: { userId: string; userName: string; initialDate?: Date; initialOwner?: string; onDateChange?: (date: Date) => void; onOwnerChange?: (owner?: string) => void }) {
  const [caps, setCaps] = useState<Capabilities>({ can_share: false, can_manage: false }), [received, setReceived] = useState<Share[]>([]), [owner, setOwner] = useState(initialOwner), [dialog, setDialog] = useState<'share'>(), [error, setError] = useState('');
  const [revision, refresh] = useInvalidation(), [dataRevision, refreshData] = useInvalidation();
  const [accessEpoch, setAccessEpoch] = useState(0), [accessPending, setAccessPending] = useState(false), [loaded, setLoaded] = useState(false);
  const ownerRef = useRef(owner); ownerRef.current = owner;
  const chooseOwner = (value?: string) => { setOwner(value); onOwnerChange?.(value); };
  useEffect(() => {
    const verify = () => { setAccessEpoch(value=>value+1); setAccessPending(true); refresh(); };
    const change = (event: Event) => {
      const topics=(event as CustomEvent<string[]>).detail;
      if(topics.includes('calendar-sharing')) verify();
      else if(topics.includes('shared-calendar')) refreshData();
    };
    window.addEventListener(WORKSPACE_CHANGED,change); window.addEventListener('focus',verify); window.addEventListener('online',verify);
    return ()=>{window.removeEventListener(WORKSPACE_CHANGED,change);window.removeEventListener('focus',verify);window.removeEventListener('online',verify);};
  },[refresh,refreshData]);
  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([accessApi.capabilities(controller.signal),sharingApi.received(controller.signal)]).then(([capabilities,rows])=>{
      if(controller.signal.aborted)return;
      setCaps(capabilities);setReceived(rows);setLoaded(true);setAccessPending(false);setError('');
      if(ownerRef.current&&!rows.some(row=>row.owner_id===ownerRef.current)){setOwner(undefined);setError('Lịch không còn được chia sẻ với bạn.');}
    }).catch(reason=>{
      if(!controller.signal.aborted){setCaps({can_share:false,can_manage:false});setReceived([]);setAccessPending(false);setError(reason.message);}
    });
    return ()=>controller.abort();
  },[revision,userId]);
  const navigation = <div className="calendar-sharing-navigation">{error && <p role="alert" className="calendar-error-state">{error}</p>}<button type="button" className={`sharing-calendar-choice ${!owner ? 'is-active' : ''}`} onClick={() => chooseOwner(undefined)}><CalendarDays size={17} /> Lịch của tôi</button>{caps.can_share && !owner && <button type="button" className="btn btn-outline btn-sm" onClick={() => setDialog('share')}><Share2 size={16} /> Chia sẻ lịch</button>}{!!received.length && <><h3 className="calendar-eyebrow">ĐƯỢC CHIA SẺ VỚI TÔI</h3>{received.map(row => <button type="button" key={row.id} className={`sharing-calendar-choice ${owner === row.owner_id ? 'is-active' : ''}`} onClick={() => chooseOwner(row.owner_id)}><Eye size={16} /><span>{row.name}<small>Chỉ xem</small></span></button>)}</>}</div>;
  const share = received.find(row => row.owner_id === owner);
  return <>{owner ? loaded && share ? <SharedCalendarView key={share.id} share={share} initialDate={initialDate} onDateChange={onDateChange} revision={dataRevision} accessEpoch={accessEpoch} accessPending={accessPending} navigation={navigation} /> : <div className="calendar-page"><p role="status">{error ? 'Chưa tải được lịch được chia sẻ.' : 'Đang kiểm tra quyền xem lịch…'}</p>{error && <button type="button" className="btn btn-outline btn-sm" onClick={refresh}>Thử lại</button>}{navigation}</div> : <CalendarPage userId={userId} userName={userName} initialDate={initialDate} onDateChange={onDateChange} sharingControls={navigation} />}{dialog === 'share' && caps.can_share && <ManageSharing revision={revision} userId={userId} onClose={() => setDialog(undefined)} onChanged={refresh} />}</>;
}

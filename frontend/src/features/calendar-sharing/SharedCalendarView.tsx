import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, RefreshCw } from 'lucide-react';
import { addDays, addMonths, dateKey, formatDate, monthDays, today, toTimestamp, viewRange } from '../calendar/dateUtils';
import { CalendarView } from '../calendar/types';
import { useTasks } from '../tasks/context/TasksContext';
import { useInvalidation } from '../realtime/useInvalidation';
import { Share, SharedItem } from './api';
import { isOverdue, sortTasks } from '../tasks/deadlineUtils';
import { SharedOverdueGroup } from './components/SharedOverdueGroup';
import { permitted, sharedTask } from './sharedItemUtils';
import { useSharedCalendar, useSharedDetail } from './hooks/useSharedCalendar';
import { SharedWeekView } from './components/SharedWeekView';
import { SharedCalendarList } from './components/SharedCalendarList';
import { SharedItemDialog } from './components/SharedItemDialog';
import { EventStatusLegend } from '../calendar/components/EventStatusBadge';

export function SharedCalendarView({ share, revision, accessEpoch, accessPending, navigation, initialDate }: {
  share: Share; revision: number; accessEpoch: number; accessPending: boolean; navigation: ReactNode; initialDate?: Date;
}) {
  const { now }=useTasks();
  const [anchor,setAnchor]=useState(initialDate??today), [view,setView]=useState<CalendarView>(()=>window.matchMedia('(max-width:768px)').matches?'agenda':'week');
  const [showEarlyHours,setShowEarlyHours]=useState(false), [selected,setSelected]=useState<SharedItem>(), [notice,setNotice]=useState('');
  const [manualRevision,refresh]=useInvalidation();
  const range=viewRange(anchor,view), start=toTimestamp(range.start), end=toTimestamp(range.end);
  const data=useSharedCalendar(share,start,end,revision+manualRevision,accessEpoch);
  const unavailable=useCallback(()=>{setSelected(undefined);setNotice('Mục đã bị xóa, chuyển riêng tư hoặc không còn được chia sẻ.');},[]);
  const detail=useSharedDetail(share.owner_id,selected,revision+manualRevision,accessEpoch,unavailable);
  const select=(item:SharedItem)=>{setNotice('');setSelected(item);};
  const selectedAllowed=selected && permitted(selected,share);
  useEffect(()=>{if(selected&&!permitted(selected,share)){setSelected(undefined);setNotice('Mục không còn nằm trong phạm vi được chia sẻ.');}},[selected,share.share_events,share.share_tasks,share.share_notes]);
  const verifying=accessPending || !data.visible;
  const taskLookup=new Map(data.items.filter(item=>item.kind==='task').map(item=>[item.id,item]));
  const overdue=sortTasks([...taskLookup.values()].map(sharedTask).filter(task=>isOverdue(task,now))).map(task=>taskLookup.get(task.id)!);
  const gridItems=data.items;
  const days=Array.from({length:view==='week'?7:30},(_,i)=>addDays(range.start,i));
  const earlyCount=gridItems.filter(item=>item.kind==='task'?!!item.due_time && item.due_time<'06:00':!item.is_all_day && days.some(day=>Date.parse(item.starts_at!)<Date.parse(toTimestamp(day,'06:00'))&&Date.parse(item.ends_at!)>Date.parse(toTimestamp(day)))).length;
  const move=(step:number)=>setAnchor(view==='month'?addMonths(anchor,step):addDays(anchor,step*(view==='week'?7:30)));
  const showDay=(day:Date)=>{setAnchor(day);setView('agenda');};
  const current=dateKey(viewRange(today(),view).start)===dateKey(range.start);
  return <div className="calendar-page shared-calendar-page">
    <div className="calendar-page-heading"><div className="calendar-page-heading-icon"><Eye size={25}/></div><div><h1>Lịch của {share.name}</h1><p>Chỉ xem · Giờ Việt Nam (UTC+7)</p></div></div>
    <div className="calendar-shell"><aside className="calendar-sidebar">{navigation}
      <div className="sharing-readonly-info"><Eye size={18}/><p>Bạn chỉ xem các mục được chia sẻ. Sự kiện, công việc và ghi chú riêng tư được ẩn hoàn toàn.</p></div>
      <div className="sharing-scope-chips">{share.share_events&&<span>Sự kiện</span>}{share.share_tasks&&<span>Công việc</span>}{share.share_notes&&<span>Ghi chú</span>}</div>
      {(share.share_events||share.share_notes)&&<div className="calendar-event-legend-section"><h4>Trạng thái sự kiện và ghi chú</h4><EventStatusLegend/></div>}
    </aside><section className="calendar-main" aria-label={`Lịch được chia sẻ của ${share.name}`}>
      <div className="calendar-toolbar"><div className="calendar-toolbar-navigation"><button type="button" className="btn btn-outline btn-sm" disabled={current} onClick={()=>setAnchor(today())}>Hôm nay</button><button type="button" className="calendar-icon-button" aria-label="Khoảng trước" onClick={()=>move(-1)}><ChevronLeft size={19}/></button><button type="button" className="calendar-icon-button" aria-label="Khoảng sau" onClick={()=>move(1)}><ChevronRight size={19}/></button><h2>{view==='month'?formatDate(anchor,{month:'long',year:'numeric'}):`${formatDate(range.start)} – ${formatDate(addDays(range.end,-1))}`}</h2></div>
        <div className="calendar-toolbar-actions"><button type="button" className="calendar-icon-button" title="Tải lại" aria-label="Tải lại lịch được chia sẻ" onClick={refresh} disabled={data.pending}><RefreshCw size={17}/></button>
          {view==='week'&&<label className="calendar-night-toggle"><input type="checkbox" checked={showEarlyHours} onChange={e=>setShowEarlyHours(e.target.checked)}/>Hiện khung giờ đêm</label>}
          <div className="calendar-view-switch" role="group" aria-label="Chế độ xem lịch">{(['week','month','agenda']as const).map(value=><button type="button" key={value} aria-pressed={view===value} className={view===value?'is-active':''} onClick={()=>setView(value)}>{value==='week'?'Tuần':value==='month'?'Tháng':'Danh sách'}</button>)}</div></div>
      </div>
      <div className="calendar-status" role="status">{data.error?'Chưa tải được lịch.':verifying?'Đang kiểm tra quyền xem…':`${data.total??0} mục được chia sẻ · Chỉ xem`}{data.pending&&!verifying&&<span>Đang cập nhật…</span>}</div>
      {data.truncated&&!verifying&&<p className="calendar-error-state">Chỉ hiển thị 500 mục. Hãy thu hẹp khoảng xem.</p>}
      {notice&&<p className="shared-notice" role="status">{notice}</p>}
      {data.error&&<div role="alert" className="calendar-error-state"><p>{data.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={refresh}>Thử lại</button></div>}
      {view==='week'&&!showEarlyHours&&earlyCount>0&&!verifying&&<button type="button" className="shared-early-notice" onClick={()=>setShowEarlyHours(true)}>Có {earlyCount} mục trong khung giờ 00:00–06:00 · Bấm để xem</button>}
      <div className="shared-calendar-content" aria-busy={data.pending} style={verifying?{visibility:'hidden'}:undefined}>
        <SharedOverdueGroup key={`${start}:${end}`} items={overdue} now={now} onSelect={select}/>
        {view==='week'?<SharedWeekView anchor={anchor} items={gridItems} now={now} showEarlyHours={showEarlyHours} onSelect={select} onShowDay={showDay}/>:<SharedCalendarList anchor={anchor} days={view==='month'?monthDays(anchor):days} items={gridItems} now={now} month={view==='month'} onSelect={select} onShowDay={showDay}/>}
      </div>
    </section></div>
    {selectedAllowed&&<SharedItemDialog selected={selected} item={detail.item} pending={detail.pending} verifying={verifying} error={detail.error} onClose={()=>setSelected(undefined)} onRetry={refresh}/>}
  </div>;
}

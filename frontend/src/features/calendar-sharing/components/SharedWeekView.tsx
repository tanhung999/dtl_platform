import { CSSProperties, useLayoutEffect, useRef } from 'react';
import { CalendarItemTitle } from '../../calendar/components/CalendarItemTitle';
import { allDayPlacements } from '../../calendar/allDayPlacements';
import { DEADLINE_MARKER_HEIGHT, weekTimedPlacements } from '../../calendar/deadlinePlacements';
import { addDays, dateKey, eventTime, formatDate, startOfWeek, toTimestamp, WEEKDAYS } from '../../calendar/dateUtils';
import { eventStatus } from '../../calendar/eventStatus';
import { SharedItem } from '../api';
import { sharedEvent, sharedTask, sharedRangeLabel } from '../sharedItemUtils';
import { SharedItemCard } from './SharedItemCard';

export function SharedWeekView({ anchor, items, now, showEarlyHours, onSelect, onShowDay }: {
  anchor: Date; items: SharedItem[]; now: Date; showEarlyHours: boolean;
  onSelect: (item: SharedItem) => void; onShowDay: (day: Date) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const weekStart = startOfWeek(anchor), weekKey = dateKey(weekStart), startMinute = showEarlyHours ? 0 : 360;
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const events = items.filter(item => item.kind !== 'task').map(sharedEvent), tasks = items.filter(item => item.kind === 'task').map(sharedTask);
  const lookup = new Map(items.map(item => [item.id, item]));
  const allDay = allDayPlacements(events, tasks, anchor), rows = Math.max(1, Math.min(4, allDay.reduce((max, item) => Math.max(max, item.lane+1), 0)));
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  const [hours, minutes] = eventTime(now.toISOString()).split(':').map(Number), currentMinute = hours*60+minutes;
  useLayoutEffect(() => { if (scroll.current) scroll.current.scrollTop = showEarlyHours ? 0 : 120; }, [weekKey, showEarlyHours]);
  return <div className="calendar-week-scroll shared-week-scroll" ref={scroll}><div className="calendar-week">
    <div className="calendar-week-header"><span className="calendar-zone">GMT+7</span>{days.map((day, index) => <div className={`calendar-week-day ${dateKey(day) === todayKey ? 'is-today' : ''}`} key={dateKey(day)}><span>{WEEKDAYS[index]}</span><button type="button" aria-label={`Xem ngày ${formatDate(day)}`} onClick={() => onShowDay(day)}>{day.getUTCDate()}</button></div>)}</div>
    <div className="calendar-week-all-day shared-week-all-day" style={{ gridTemplateRows: `repeat(${rows}, 32px) 26px`, rowGap:4 }}>
      <span className="calendar-zone" style={{ gridColumn:1, gridRow:`1 / span ${rows+1}` }}>Cả ngày</span>
      {days.map((day, index) => <div key={dateKey(day)} className={`calendar-all-day-background ${dateKey(day) === todayKey ? 'is-today' : ''}`} style={{ gridColumn:index+2, gridRow:`1 / span ${rows+1}` }} />)}
      {allDay.filter(item => item.lane<4).map(placement => {
        const style = { gridColumn:`${placement.start+2} / span ${placement.end-placement.start+1}`, gridRow:placement.lane+1 };
        if (placement.kind === 'deadline') return <div key={placement.task.id} className="calendar-all-day-cell calendar-all-day-placement" style={style}><SharedItemCard item={lookup.get(placement.task.id)!} day={dateKey(days[placement.start])} now={now} onSelect={onSelect} compact /></div>;
        const event=placement.event, item=lookup.get(event.id)!, covered=days.slice(placement.start, placement.end+1);
        const before=Date.parse(event.starts_at)<Date.parse(toTimestamp(weekStart)), after=Date.parse(event.ends_at)>Date.parse(toTimestamp(addDays(weekStart,7)));
        return <div key={event.id} className="calendar-all-day-event-frame shared-all-day-frame" style={style}><button type="button" data-shared-id={item.id} data-shared-kind={item.kind}
          className={`calendar-event is-compact calendar-all-day-span shared-calendar-item ${item.kind === 'note' ? 'is-note' : ''}`} title={sharedRangeLabel(item)} onClick={() => onSelect(item)} style={{ '--event-color':eventStatus(event,now,dateKey(covered[0])).color } as CSSProperties}>
          <span className="calendar-all-day-segments" aria-hidden="true">{covered.map(day => <span key={dateKey(day)} style={{ '--event-color':eventStatus(event,now,dateKey(day)).color } as CSSProperties} />)}</span>
          {before && <span className="calendar-all-day-continuation" aria-label="Tiếp tục từ tuần trước">◂</span>}<span className="calendar-event-title"><CalendarItemTitle event={event} compact /></span><span className="calendar-event-time">Cả ngày</span>{after && <span className="calendar-all-day-continuation" aria-label="Tiếp tục sang tuần sau">▸</span>}
        </button></div>;
      })}
      {days.map((day,index) => { const extra=allDay.filter(item=>item.lane>=4 && item.start<=index && item.end>=index).length;
        return <div key={dateKey(day)} className="calendar-all-day-footer" style={{ gridColumn:index+2, gridRow:rows+1 }}>{extra>0 && <button type="button" className="calendar-more" onClick={()=>onShowDay(day)}>+{extra} mục</button>}</div>;
      })}
    </div>
    <div className="calendar-week-timeline" style={{ height:1440-startMinute+48 }}>
      <div className="calendar-hours">{Array.from({length:24-startMinute/60},(_,i)=>i+startMinute/60).map(hour=><div key={hour}>{String(hour).padStart(2,'0')}:00</div>)}</div>
      {days.map(day=><div key={dateKey(day)} className={`calendar-time-column ${dateKey(day)===todayKey?'is-today':''}`} style={{height:1440-startMinute+48}}>
        {Array.from({length:24-startMinute/60},(_,i)=><div className="calendar-time-slot" key={i} />)}
        {weekTimedPlacements(events,tasks,day,startMinute).map(placement=>{
          const item=lookup.get(placement.kind==='event'?placement.event.id:placement.task.id)!;
          return <SharedItemCard key={item.id} item={item} day={dateKey(day)} now={now} onSelect={onSelect} startMinute={startMinute}
            style={{position:'absolute',top:placement.start-startMinute,height:placement.kind==='deadline'?DEADLINE_MARKER_HEIGHT:Math.max(48,placement.end-placement.start),left:`calc(${placement.lane/placement.lanes*100}% + 2px)`,width:`calc(${100/placement.lanes}% - 4px)`}} />;
        })}
        {dateKey(day)===todayKey && currentMinute>=startMinute && <div className="calendar-now-line" style={{top:currentMinute-startMinute}}><span /></div>}
      </div>)}
    </div>
  </div></div>;
}

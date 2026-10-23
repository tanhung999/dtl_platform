import { useRef } from 'react';
import { useScrollMemory } from '../../../services/viewMemory';
import { dateKey, eventDate, formatDate, WEEKDAYS } from '../../calendar/dateUtils';
import { SharedItem } from '../api';
import { sharedItemsOnDay } from '../sharedItemUtils';
import { SharedItemCard } from './SharedItemCard';

export function SharedCalendarList({ ownerId, anchor, days, items, now, month, onSelect, onShowDay }: {
  ownerId: string; anchor: Date; days: Date[]; items: SharedItem[]; now: Date; month: boolean; onSelect: (item: SharedItem) => void; onShowDay: (day: Date) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  useScrollMemory(scroll, `shared/${ownerId}/${month}/${dateKey(anchor)}`);
  return <div ref={scroll} className={month ? 'shared-month-scroll' : 'shared-agenda'}>
    {month && <div className="shared-month-weekdays">{WEEKDAYS.map(day=><span key={day}>{day}</span>)}</div>}
    <div className={month ? 'shared-month-grid' : ''}>{days.map(day=>{
      const values=sharedItemsOnDay(items,day), visible=month?values.slice(0,4):values;
      if(!month && !values.length) return null;
      return <section key={dateKey(day)} className={`${dateKey(day)===dateKey(eventDate(now.toISOString()))?'is-today':''} ${month&&day.getUTCMonth()!==anchor.getUTCMonth()?'is-outside':''}`}><h3>{formatDate(day,{weekday:'short',day:'numeric',month:'numeric'})}</h3>
        {visible.map(item=><SharedItemCard key={item.id} item={item} day={dateKey(day)} now={now} onSelect={onSelect} compact={month} />)}
        {month && values.length>visible.length && <button type="button" className="calendar-more" onClick={()=>onShowDay(day)}>+{values.length-visible.length} mục</button>}
      </section>;
    })}</div>{!month && !items.length && <p className="shared-empty">Không có mục nào trong khoảng đang xem.</p>}
  </div>;
}

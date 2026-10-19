import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { SharedItem } from '../api';
import { overdueLabel } from '../../tasks/deadlineUtils';
import { sharedTask } from '../sharedItemUtils';
import { SharedItemCard } from './SharedItemCard';

export function SharedOverdueGroup({ items, now, onSelect }: {items:SharedItem[];now:Date;onSelect:(item:SharedItem)=>void}) {
  const [expanded,setExpanded]=useState(false);
  if(!items.length)return null;
  const visible=expanded?items:items.slice(0,3);
  return <section className="calendar-overdue-group shared-overdue-group" aria-label="Việc quá hạn được chia sẻ"><div className="calendar-overdue-heading"><AlertCircle size={15}/>Quá hạn<span>{items.length} việc trong khoảng đang xem</span></div>
    <div className={expanded?'shared-overdue-expanded':''}>{visible.map(item=><div className="shared-overdue-line" key={item.id}><SharedItemCard item={item} day={item.due_date!} now={now} onSelect={onSelect} includeDate/><span>{overdueLabel(sharedTask(item),now)}</span></div>)}</div>
    {items.length>3&&<button type="button" className="calendar-text-button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Thu gọn':`+${items.length-3} việc quá hạn`}</button>}
  </section>;
}

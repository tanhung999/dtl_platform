import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { SharedItem } from '../api';
import { overdueLabel } from '../../tasks/deadlineUtils';
import { sharedTask } from '../sharedItemUtils';
import { SharedItemCard } from './SharedItemCard';

export function SharedOverdueGroup({ items, now, onSelect }: {items:SharedItem[];now:Date;onSelect:(item:SharedItem)=>void}) {
  const [expanded,setExpanded]=useState(false);
  if(!items.length)return null;
  return <section className="calendar-overdue-group calendar-overdue-compact shared-overdue-group" aria-label="Công việc quá hạn được chia sẻ">
    <div className="calendar-overdue-compact-heading"><span className="calendar-overdue-label"><AlertCircle size={15}/><strong>Quá hạn</strong><span className="calendar-overdue-count">{items.length} việc</span></span><button type="button" aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'Thu gọn':'Mở rộng'}{expanded?<ChevronUp size={13} aria-hidden="true"/>:<ChevronDown size={13} aria-hidden="true"/>}</button></div>
    {expanded&&<div className="shared-overdue-expanded">{items.map(item=><div className="shared-overdue-line" key={item.id}><SharedItemCard item={item} day={item.due_date!} now={now} onSelect={onSelect} includeDate/><span>{overdueLabel(sharedTask(item),now)}</span></div>)}</div>}
  </section>;
}

import { CSSProperties } from 'react';
import { CalendarDays, CheckSquare, Square, StickyNote } from 'lucide-react';
import { CalendarEvent } from '../../calendar/types';
import { eventContinuation, eventContinuesNextDay, eventDayLabel } from '../../calendar/dateUtils';
import { eventStatus } from '../../calendar/eventStatus';
import { SharedItem } from '../api';
import { sharedEvent, sharedItemTooltip } from '../sharedItemUtils';
import '../../tasks/priority.css';
import { deadlineLabel } from '../../tasks/deadlineUtils';
import { sharedTask } from '../sharedItemUtils';

interface Props { item: SharedItem; day: string; now: Date; onSelect: (item: SharedItem) => void; style?: CSSProperties; compact?: boolean; startMinute?: number; includeDate?: boolean }
export function SharedItemCard({ item, day, now, onSelect, style, compact, startMinute = 0, includeDate = false }: Props) {
  const isTask = item.kind === 'task';
  const Icon = isTask ? item.is_completed ? CheckSquare : Square : item.kind === 'note' ? StickyNote : CalendarDays;
  const event: CalendarEvent | undefined = isTask ? undefined : sharedEvent(item);
  const status = event && eventStatus(event, now, day);
  const continuation = event && eventContinuation(event, day, startMinute);
  const continues = event && eventContinuesNextDay(event, day);
  return <button type="button" data-shared-id={item.id} data-shared-kind={item.kind} data-task-priority={isTask ? item.priority : undefined}
    className={`shared-calendar-item ${isTask ? 'is-deadline' : ''} ${item.kind === 'note' ? 'is-note' : ''} ${item.is_completed ? 'is-completed' : ''} ${compact ? 'is-compact' : ''}`}
    style={{ ...style, '--event-color': status?.color } as CSSProperties} title={sharedItemTooltip(item, now)} onClick={() => onSelect(item)}>
    {isTask ? <span className="shared-deadline-line"><Icon size={15} /><b>{deadlineLabel(sharedTask(item),includeDate)}</b><span>{item.title}</span></span>
      : <><strong>{continuation && <span role="img" aria-label={continuation}>↑</span>}<Icon size={14} /><span>{item.title}</span></strong>
        {(!compact || !event!.is_all_day) && <small>{eventDayLabel(event!, day, true)}</small>}
        {continues && !compact && <span className="shared-next-day" role="img" aria-label="Tiếp tục sang ngày sau">↓</span>}</>}
  </button>;
}

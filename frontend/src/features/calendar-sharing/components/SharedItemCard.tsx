import { PriorityIcon } from '../../tasks/components/PriorityIcon';
import { EventContinuationMarker } from '../../calendar/components/EventContinuationMarker';
import { CSSProperties } from 'react';
import { CalendarDays, StickyNote } from 'lucide-react';
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
  const timeLabel = item.kind === 'task' ? deadlineLabel(sharedTask(item), includeDate, false) : '';
  const isTask = item.kind === 'task';
  const Icon = item.kind === 'note' ? StickyNote : CalendarDays;
  const event: CalendarEvent | undefined = isTask ? undefined : sharedEvent(item);
  const status = event && eventStatus(event, now, day);
  const continuation = event && eventContinuation(event, day, startMinute);
  const continues = event && eventContinuesNextDay(event, day);
  const timeline = style?.position === 'absolute';
  const startsBefore = timeline && Boolean(continuation);
  const continuesAfter = timeline && Boolean(continues);
  const card = <button type="button" data-shared-id={item.id} data-shared-kind={item.kind} data-task-priority={isTask ? item.priority : undefined}
    className={`shared-calendar-item ${isTask ? 'is-deadline' : ''} ${item.kind === 'note' ? 'is-note' : ''} ${item.is_completed ? 'is-completed' : ''} ${compact ? 'is-compact' : ''} ${startsBefore || continuesAfter ? 'has-continuation' : ''} ${startsBefore ? 'has-continuation-start' : ''} ${continuesAfter ? 'has-continuation-end' : ''}`}
    style={{ ...(timeline ? {} : style), '--event-color': status?.color } as CSSProperties} data-tooltip={sharedItemTooltip(item, now)} aria-label={sharedItemTooltip(item, now)} onClick={() => onSelect(item)}>
    {isTask ? <span className="shared-deadline-line"><PriorityIcon priority={sharedTask(item).priority} /><span className="shared-deadline-summary">{timeLabel && <><b>{timeLabel}</b>{' '}</>}<span>{item.title}</span></span></span>
      : <>{startsBefore && <EventContinuationMarker direction="start" label={continuation!} />}<strong>{!timeline && continuation && <span role="img" aria-label={continuation}>↑</span>}<Icon size={14} /><span>{item.title}</span></strong>
        {(!compact || !event!.is_all_day) && <small>{eventDayLabel(event!, day, true)}</small>}
        {continues && !compact && (timeline ? <EventContinuationMarker direction="end" label="Tiếp tục sang ngày sau" /> : <span className="shared-next-day" role="img" aria-label="Tiếp tục sang ngày sau">↓</span>)}</>}
  </button>;
  return timeline ? <div className="calendar-event-frame shared-timed-frame" style={style}>{card}</div> : card;
}

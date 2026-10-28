import { CSSProperties, useEffect, useRef } from 'react';
import { CalendarDays, CheckSquare, Clock, StickyNote, X } from 'lucide-react';
import { addDays, dateKey, eventDayLabel, formatDate, toTimestamp } from '../../calendar/dateUtils';
import { eventStatus } from '../../calendar/eventStatus';
import { EventStatusBadge } from '../../calendar/components/EventStatusBadge';
import { PriorityIcon } from '../../tasks/components/PriorityIcon';
import { deadlineLabel, isOverdue } from '../../tasks/deadlineUtils';
import { Share, SharedItem } from '../api';
import { useSharedCalendar } from '../hooks/useSharedCalendar';
import { sharedEvent, sharedItemsOnDay, sharedTask } from '../sharedItemUtils';

interface Props {
  day: Date; share: Share; now: Date; revision: number; accessEpoch: number; accessPending: boolean;
  onClose: () => void; onSelect: (item: SharedItem) => void; onRetry: () => void;
}

export function SharedDayItemsDialog({ day, share, now, revision, accessEpoch, accessPending, onClose, onSelect, onRetry }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useSharedCalendar(share, toTimestamp(day), toTimestamp(addDays(day, 1)), revision, accessEpoch);
  const visible = !accessPending && data.visible;
  const items = visible ? sharedItemsOnDay(data.items, day) : [];
  const sections = [
    { kind: 'event', name: 'Sự kiện', enabled: share.share_events, Icon: CalendarDays },
    { kind: 'note', name: 'Ghi chú', enabled: share.share_notes, Icon: StickyNote },
    { kind: 'task', name: 'Công việc', enabled: share.share_tasks, Icon: CheckSquare },
  ] as const;
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={dialog} className="calendar-day-dialog shared-day-dialog" aria-labelledby="shared-day-dialog-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="calendar-day-dialog-header">
      <div><p>Lịch trong ngày · Chỉ xem</p><h2 id="shared-day-dialog-title">{formatDate(day, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</h2></div>
      <button type="button" className="calendar-icon-button" aria-label="Đóng danh sách trong ngày" onClick={onClose}><X size={20} /></button>
    </header>
    <div className="calendar-day-dialog-body" aria-busy={data.pending || accessPending}>
      <p className="calendar-day-filter-hint">Lịch của {share.name}. Chỉ hiển thị các mục bạn được phép xem.</p>
      {data.error && <div className="calendar-error-state" role="alert"><p>{data.error}</p><button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Thử lại</button></div>}
      {!data.error && (!visible || data.pending) && <p className="calendar-day-feedback" role="status">{visible ? 'Đang cập nhật…' : 'Đang kiểm tra quyền và tải lịch trong ngày…'}</p>}
      {visible && sections.filter(section => section.enabled).map(({ kind, name, Icon }) => {
        const values = items.filter(item => item.kind === kind);
        return <section key={kind} className={`calendar-day-section is-${kind}`} aria-label={name}>
          <h3><Icon size={17} />{name}<span>{values.length}{data.truncated ? '+' : ''}</span></h3>
          {values.map(item => {
            const task = kind === 'task' ? sharedTask(item) : undefined;
            const event = task ? undefined : sharedEvent(item);
            const status = event && eventStatus(event, now, dateKey(day));
            return <button type="button" key={item.id} data-shared-id={item.id} data-shared-kind={kind} data-task-priority={task?.priority}
              className={`calendar-day-item ${task?.is_completed ? 'is-completed' : ''}`} style={{ '--event-color': status?.color } as CSSProperties}
              onClick={() => { onClose(); onSelect(item); }}>
              <strong>{task ? <PriorityIcon priority={task.priority} /> : <Icon size={14} />}<span className={task ? 'calendar-day-task-title' : undefined}>{item.title || 'Ghi chú không có tiêu đề'}</span></strong>
              <span className="calendar-day-item-meta"><span><Clock size={13} />{task ? deadlineLabel(task, false, false) || 'Hạn cả ngày' : eventDayLabel(event!, dateKey(day))}</span>
                {status ? <EventStatusBadge status={status} /> : task && <span className={isOverdue(task, now) ? 'calendar-day-overdue' : ''}>{task.is_completed ? 'Đã hoàn thành' : isOverdue(task, now) ? 'Quá hạn' : 'Chưa hoàn thành'}</span>}</span>
              {item.location && <span className="calendar-day-location">{item.location}</span>}
            </button>;
          })}
          {!values.length && <p className="calendar-day-feedback">{data.truncated ? 'Chưa có mục nào trong phần đã tải.' : `Không có ${name.toLocaleLowerCase('vi')} được chia sẻ trong ngày.`}</p>}
        </section>;
      })}
      {visible && !items.length && !data.pending && !data.truncated && <p className="calendar-day-empty">Không có mục nào được chia sẻ trong ngày này.</p>}
      {visible && data.truncated && <div className="calendar-day-load-more"><button type="button" className="btn btn-outline btn-sm" disabled={data.pending} onClick={() => { void data.loadMore(); }}>Tải thêm</button></div>}
    </div>
  </dialog>;
}

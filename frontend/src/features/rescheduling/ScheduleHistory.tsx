import { Bell, CalendarClock, History, LockKeyhole, RotateCcw } from 'lucide-react';
import type { Change, Kind } from './api';
import { notificationLabel, sameScheduleFields, scheduleLabel } from './labels';
import { sameReminder } from '../reminders/ReminderFields';

function Comparison({ before, after }: { before: string; after: string }) {
  return <dl className="schedule-history-comparison"><div><dt>Trước</dt><dd>{before}</dd></div><div><dt>Sau</dt><dd>{after}</dd></div></dl>;
}

export function ScheduleHistory({ kind, entries, error, onRetry }: { kind: Kind; entries?: Change[]; error: string; onRetry: () => void }) {
  return <section className="reschedule-history" aria-label="Lịch sử dời lịch và thông báo" aria-busy={!entries && !error}>
    <div className="schedule-history-caption"><span><LockKeyhole size={13} aria-hidden="true" />Chỉ bạn xem được</span>{!!entries?.length && <span>20 lần gần nhất</span>}</div>
    {error ? <div className="schedule-history-state is-error" role="alert"><strong>Không tải được lịch sử</strong><p>{error}</p><button type="button" className="btn btn-outline btn-sm" onClick={onRetry}>Thử lại</button></div>
      : !entries ? <div className="schedule-history-state" role="status"><History size={24} aria-hidden="true" /><p>Đang tải lịch sử…</p></div>
      : !entries.length ? <div className="schedule-history-state"><span className="schedule-history-empty-icon"><History size={25} aria-hidden="true" /></span><strong>Chưa có thay đổi</strong><p>Các lần dời lịch hoặc đổi thông báo sẽ hiển thị tại đây.</p></div>
      : <ol className="schedule-history-list">{entries.map(entry => {
        const moved = !sameScheduleFields(entry.before, entry.after);
        const reminderChanged = !sameReminder(entry.before, entry.after);
        const scope = entry.guard.scoped?.scope ?? entry.guard.family?.scope;
        const recurring = kind !== 'task' && (entry.guard.scoped || entry.guard.family || entry.before.recurrence && entry.before.recurrence !== 'NONE');
        const Icon = moved ? CalendarClock : Bell;
        return <li key={entry.id}><article className="schedule-history-card">
          <div className="schedule-history-card-heading"><span className="schedule-history-type"><Icon size={16} aria-hidden="true" /><strong>{moved ? 'Dời lịch' : 'Đổi thông báo'}</strong></span>{entry.undone_at && <span className="schedule-history-badge"><RotateCcw size={12} aria-hidden="true" />Đã hoàn tác</span>}</div>
          {recurring && <span className="schedule-history-scope">{scope === 'THIS' ? 'Chỉ lần này' : scope === 'FOLLOWING' ? 'Lần này và các lần sau' : 'Cả chuỗi'}</span>}
          <Comparison before={moved ? scheduleLabel(entry.before) : notificationLabel(entry.before)} after={moved ? scheduleLabel(entry.after) : notificationLabel(entry.after)} />
          {moved && reminderChanged && <div className="schedule-history-reminder"><span><Bell size={13} aria-hidden="true" />Thông báo</span><Comparison before={notificationLabel(entry.before)} after={notificationLabel(entry.after)} /></div>}
          {entry.reason?.trim() && <p className="schedule-history-reason"><strong>Lý do:</strong> {entry.reason}</p>}
          <div className="schedule-history-meta">{entry.actor_name && <span>{entry.actor_name}</span>}<time dateTime={entry.created_at}>{new Date(entry.created_at).toLocaleString('vi-VN', { timeZone:'Asia/Ho_Chi_Minh', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:false })}</time></div>
        </article></li>;
      })}</ol>}
  </section>;
}

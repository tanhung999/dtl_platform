"""Một lần nhắc theo lựa chọn người dùng; không tự tạo giai đoạn thông báo."""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from sqlalchemy import delete
from app.core.datetime_utils import database_utc
from app.db.models import utcnow
from app.db.notifications import NotificationJob as Job
from app.modules.tasks.deadlines import deadline_at
from .service import insert_unique

def recurring_period(row):
    days = {"DAILY": 1, "WEEKLY": 7}.get(getattr(row, "recurrence", "NONE"))
    return timedelta(days=days) if days else None

def repeating_reminder_period(row):
    # Missing attributes support older lightweight callers; persisted events
    # always have an explicit opt-in flag after the additive migration.
    configured = row.reminder_minutes is not None or row.reminder_at is not None
    return recurring_period(row) if configured and getattr(row, 'reminder_repeat', row.reminder_minutes is not None) else None


def custom_clock_stamp(row, stamp):
    vn = timezone(timedelta(hours=7))
    return datetime.combine(database_utc(row.starts_at).astimezone(vn).date(), database_utc(stamp).astimezone(vn).timetz()).astimezone(timezone.utc)


def first_reminder_stamp(row):
    if row.reminder_minutes is not None:
        return database_utc(row.starts_at) - timedelta(minutes=row.reminder_minutes)
    stamp = database_utc(row.reminder_at)
    if repeating_reminder_period(row):
        stamp = custom_clock_stamp(row, stamp)
    return stamp


def reminder_occurrence(row, stamp):
    period = repeating_reminder_period(row)
    if period:
        return database_utc(row.starts_at) + ((stamp - first_reminder_stamp(row)) // period) * period
    return database_utc(row.starts_at)


def valid_recurring_stamp(row, stamp):
    period = repeating_reminder_period(row)
    if period is None: return False
    first = first_reminder_stamp(row)
    cutoff = getattr(row, 'recurrence_until', None)
    if cutoff and reminder_occurrence(row, stamp) >= database_utc(cutoff): return False
    delta = (stamp - first).total_seconds()
    return delta >= 0 and delta % period.total_seconds() == 0



def reminder_anchor(row, kind):
    return deadline_at(row) if kind == 'task' else database_utc(row.starts_at) if kind == 'event' else None


def signature(row, kind, active=True):
    anchor = reminder_anchor(row, kind)
    values = (getattr(row, 'reminder_minutes', None), database_utc(row.reminder_at) if row.reminder_at else None, anchor,
              not row.due_time if kind == 'task' else row.is_all_day if kind == 'event' else False)
    if kind == 'event': values += (getattr(row, 'recurrence', 'NONE'), getattr(row, 'recurrence_until', None), bool(repeating_reminder_period(row)))
    return values + (not row.is_completed if kind == 'task' else not row.is_archived if kind == 'note' else active,)


def reminder_time(row, kind, now=None):
    minutes = getattr(row, 'reminder_minutes', None)
    if minutes is None and row.reminder_at is None:
        return None
    anchor = reminder_anchor(row, kind)
    if anchor is None:
        if minutes is not None:
            raise HTTPException(422, 'Chưa có hạn để tính thông báo trước. Hãy chọn ngày và giờ thông báo cụ thể.')
        return database_utc(row.reminder_at)
    if minutes is not None:
        all_day = not row.due_time if kind == 'task' else row.is_all_day if kind == 'event' else False
        if all_day:
            raise HTTPException(422, 'Mục cả ngày cần chọn ngày và giờ thông báo cụ thể.')
        stamp = anchor - timedelta(minutes=minutes)
        period = repeating_reminder_period(row) if kind == 'event' else None
        if period and stamp <= (now or utcnow()):
            stamp += (((now or utcnow()) - stamp) // period + 1) * period
        cutoff = getattr(row, 'recurrence_until', None) if kind == 'event' else None
        if cutoff and stamp + timedelta(minutes=minutes) >= database_utc(cutoff): return None
        return stamp
    stamp = first_reminder_stamp(row) if kind == 'event' else database_utc(row.reminder_at)
    period = repeating_reminder_period(row) if kind == 'event' else None
    if period:
        if stamp <= (now or utcnow()):
            stamp += (((now or utcnow()) - stamp) // period + 1) * period
        cutoff = getattr(row, 'recurrence_until', None)
        if cutoff and reminder_occurrence(row, stamp) >= database_utc(cutoff): return None
        return stamp
    upper = anchor if kind == 'task' else database_utc(row.ends_at)
    all_day = not row.due_time if kind == 'task' else row.is_all_day if kind == 'event' else False
    # An elapsed item may get a new absolute reminder without rescheduling it.
    # Future/ongoing items retain their deadline/end bound.
    if not (kind == 'event' and recurring_period(row)) and upper > (now or utcnow()) and (stamp > upper or (kind != 'task' or all_day) and stamp == upper):
        raise HTTPException(422, 'Giờ thông báo phải trước thời điểm kết thúc của sự kiện/ghi chú hoặc không vượt quá hạn công việc; mục cả ngày phải thông báo trước khi hết ngày.')
    return stamp


def plan(row, now, kind='task', active=True):
    enabled = not row.is_completed if kind == 'task' else not row.is_archived if kind == 'note' else active
    if not enabled:
        return []
    stamp = reminder_time(row, kind, now)
    if stamp is None or stamp <= now:
        return []
    suffix = ':' + stamp.isoformat() if kind == 'event' and repeating_reminder_period(row) else ''
    return [dict(task_id=row.id if kind == 'task' else None, event_id=row.id if kind == 'event' else None, note_id=row.id if kind == 'note' else None,
                 user_id=row.user_id, deadline_version=row.deadline_version if kind == 'task' else 0,
                 reminder_version=row.reminder_version, kind='user', event_key=f'reminder:{kind}:{row.id}:{row.reminder_version}{suffix}',
                 scheduled_at=stamp, available_at=stamp)]


async def sync_jobs(db, row, kind, now=None, before=None, active=True, allow_elapsed=False):
    now = now or utcnow()
    after = signature(row, kind, active)
    enabled = after[-1]
    stamp = reminder_time(row, kind, now)
    if before == after:
        return
    restoring = before is not None and not before[-1] and enabled and before[:-1] == after[:-1]
    selection_changed = before is None or before[:2] != after[:2]
    if stamp is not None and stamp <= now and (enabled or selection_changed) and not allow_elapsed and not restoring:
        raise HTTPException(422, 'Thời điểm thông báo đã qua. Hãy chọn lại thời gian thông báo hoặc Không nhắc.')
    if before is not None:
        row.reminder_version += 1
    owner = Job.task_id == row.id if kind == 'task' else Job.event_id == row.id if kind == 'event' else Job.note_id == row.id
    await db.execute(delete(Job).where(owner, Job.processed_at.is_(None)))
    await insert_unique(db, Job, plan(row, now, kind, active), ['event_key'])


async def sync_task_jobs(db, task, now=None, *, before=None, allow_elapsed=False, assignee_changed=False):
    await sync_jobs(db, task, 'task', now, before, allow_elapsed=allow_elapsed)
    if assignee_changed:
        await db.execute(delete(Job).where(Job.task_id == task.id, Job.kind == 'assignee', Job.processed_at.is_(None)))
    if (assignee_changed or before != signature(task, 'task')) and task.assignee_id != task.user_id:
        from app.db.notifications import TaskReminderPreference
        from app.modules.tasks.reminders import schedule_assignee
        preference = await db.get(TaskReminderPreference, (task.id, task.assignee_id))
        if preference:
            await schedule_assignee(db, task, preference, now)


async def sync_event_jobs(db, event, now=None, *, before=None, active=True, allow_elapsed=False):
    await sync_jobs(db, event, 'event', now, before, active, allow_elapsed)

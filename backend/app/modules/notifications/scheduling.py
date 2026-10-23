"""Một lần nhắc theo lựa chọn người dùng; không tự tạo giai đoạn nhắc hạn."""
from datetime import timedelta
from fastapi import HTTPException
from sqlalchemy import delete
from app.core.datetime_utils import database_utc
from app.db.models import utcnow
from app.db.notifications import NotificationJob as Job
from app.modules.tasks.deadlines import deadline_at
from .service import insert_unique


def signature(row, kind, active=True):
    anchor = deadline_at(row) if kind == 'task' else database_utc(row.starts_at)
    return (row.reminder_minutes, database_utc(row.reminder_at) if row.reminder_at else None, anchor,
            not row.due_time if kind == 'task' else row.is_all_day,
            not row.is_completed if kind == 'task' else active)


def reminder_time(row, kind):
    if row.reminder_minutes is None and row.reminder_at is None:
        return None
    anchor = deadline_at(row) if kind == 'task' else database_utc(row.starts_at)
    if anchor is None:
        raise HTTPException(422, 'Hãy đặt ngày hạn trước khi chọn nhắc nhở.')
    if row.reminder_minutes is not None:
        all_day = not row.due_time if kind == 'task' else row.is_all_day
        if all_day:
            raise HTTPException(422, 'Mục cả ngày cần chọn ngày và giờ nhắc hạn cụ thể.')
        return anchor - timedelta(minutes=row.reminder_minutes)
    stamp = database_utc(row.reminder_at)
    upper = anchor if kind == 'task' else database_utc(row.ends_at)
    all_day = not row.due_time if kind == 'task' else row.is_all_day
    if stamp > upper or (kind != 'task' or all_day) and stamp == upper:
        raise HTTPException(422, 'Giờ nhắc hạn phải trước thời điểm kết thúc của sự kiện/ghi chú hoặc không vượt quá hạn công việc; mục cả ngày phải nhắc trước khi hết ngày.')
    return stamp


def plan(row, now, kind='task', active=True):
    enabled = not row.is_completed if kind == 'task' else active
    if not enabled:
        return []
    stamp = reminder_time(row, kind)
    if stamp is None or stamp <= now:
        return []
    return [dict(task_id=row.id if kind == 'task' else None, event_id=row.id if kind != 'task' else None,
                 user_id=row.user_id, deadline_version=row.deadline_version if kind == 'task' else 0,
                 reminder_version=row.reminder_version, kind='user', event_key=f'reminder:{kind}:{row.id}:{row.reminder_version}',
                 scheduled_at=stamp, available_at=stamp)]


async def sync_jobs(db, row, kind, now=None, before=None, active=True, allow_elapsed=False):
    now = now or utcnow()
    after = signature(row, kind, active)
    enabled = after[-1]
    stamp = reminder_time(row, kind) if enabled else None
    if before == after:
        return
    restoring = before is not None and not before[-1] and enabled and before[:-1] == after[:-1]
    if stamp is not None and stamp <= now and not allow_elapsed and not restoring:
        raise HTTPException(422, 'Thời điểm nhắc đã qua. Hãy chọn lại thời gian nhắc hoặc Không nhắc.')
    if before is not None:
        row.reminder_version += 1
    owner = Job.task_id == row.id if kind == 'task' else Job.event_id == row.id
    await db.execute(delete(Job).where(owner, Job.processed_at.is_(None)))
    await insert_unique(db, Job, plan(row, now, kind, active), ['event_key'])


async def sync_task_jobs(db, task, now=None, *, before=None, allow_elapsed=False):
    await sync_jobs(db, task, 'task', now, before, allow_elapsed=allow_elapsed)


async def sync_event_jobs(db, event, now=None, *, before=None, active=True, allow_elapsed=False):
    await sync_jobs(db, event, 'event', now, before, active, allow_elapsed)

"""Assignee-only reminder selection, independent of the creator and followers."""
from types import SimpleNamespace
from fastapi import HTTPException
from pydantic import ConfigDict, Field
from sqlalchemy import delete, select
from app.core.datetime_utils import database_utc
from app.core.realtime import mark_changed
from app.db.models import User, utcnow
from app.db.notifications import NotificationJob as Job, TaskReminderPreference as Preference
from app.modules.notifications.reminder_fields import ReminderFields
from app.modules.notifications.scheduling import reminder_time
from app.modules.notifications.service import insert_unique
from .access import accessible_task


class AssigneeReminderWrite(ReminderFields):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=0)
    expected_task_version: int = Field(ge=0)


def configured_task(task, preference):
    return SimpleNamespace(due_date=task.due_date, due_time=task.due_time,
                           reminder_minutes=preference.reminder_minutes, reminder_at=preference.reminder_at)


def preference_key(task, preference):
    return f'assignee:{task.id}:{preference.user_id}:{preference.version}:{task.reminder_version}'


async def reset_invalid_assignee_reminder(db, task, now):
    preference = await db.get(Preference, (task.id, task.assignee_id))
    if preference is None or preference.reminder_minutes is None and preference.reminder_at is None:
        return False  # Explicit "no reminder" must remain an override.
    try:
        stamp = reminder_time(configured_task(task, preference), 'task', now)
    except HTTPException:
        stamp = None
    if stamp is not None and stamp > now:
        return False
    await db.execute(delete(Job).where(Job.task_id == task.id, Job.kind == 'assignee',
        Job.recipient_id == task.assignee_id, Job.processed_at.is_(None)))
    await db.delete(preference)
    await db.flush()
    return True


async def schedule_assignee(db, task, preference, now=None):
    now = now or utcnow()
    await db.execute(delete(Job).where(Job.task_id == task.id, Job.kind == 'assignee',
                                      Job.recipient_id == preference.user_id, Job.processed_at.is_(None)))
    if task.is_completed or preference.user_id != task.assignee_id or preference.user_id == task.user_id:
        return
    try:
        stamp = reminder_time(configured_task(task, preference), 'task', now)
    except HTTPException:
        # An owner's deadline edit must not be blocked by someone else's saved
        # absolute time or a relative choice that no longer fits an all-day task.
        return
    if stamp is None or stamp <= now:
        return
    await insert_unique(db, Job, [dict(task_id=task.id, user_id=task.user_id, recipient_id=preference.user_id,
        deadline_version=task.deadline_version, reminder_version=preference.version, kind='assignee',
        event_key=preference_key(task, preference), scheduled_at=stamp, available_at=stamp)], ['event_key'])


def view(task, preference):
    source = preference if preference is not None else task
    return dict(reminder_minutes=source.reminder_minutes, reminder_at=source.reminder_at,
                version=preference.version if preference else 0, task_version=task.version,
                has_override=preference is not None, due_date=task.due_date, due_time=task.due_time)


async def assignee_task(db, task_id, user, lock=False):
    task = await accessible_task(task_id, user, db, lock=lock)
    if lock:
        await db.refresh(task)
    if task.assignee_id != user.id or task.user_id == user.id:
        raise HTTPException(403, 'Chỉ người được giao công việc mới được thiết lập thông báo riêng tại đây.')
    return task


async def get_assignee_reminder(db, task_id, user):
    task = await assignee_task(db, task_id, user)
    return view(task, await db.get(Preference, (task.id, user.id)))


async def save_assignee_reminder(db, task_id, user, payload):
    # Follow the worker's user -> task -> queue lock order.
    initial = await assignee_task(db, task_id, user)
    await db.execute(select(User.id).where(User.id.in_({initial.user_id, user.id})).order_by(User.id).with_for_update())
    task = await assignee_task(db, task_id, user, lock=True)
    if task.version != payload.expected_task_version:
        raise HTTPException(409, 'Công việc vừa thay đổi. Hãy mở lại thông báo để kiểm tra hạn mới.')
    preference = await db.get(Preference, (task.id, user.id))
    current_version = preference.version if preference else 0
    if current_version != payload.expected_version:
        if preference and current_version == payload.expected_version + 1 and preference.reminder_minutes == payload.reminder_minutes and (database_utc(preference.reminder_at) if preference.reminder_at else None) == payload.reminder_at:
            return view(task, preference)
        raise HTTPException(409, 'Thông báo riêng vừa thay đổi. Hãy tải lại trước khi lưu.')
    current = preference if preference is not None else task
    if current.reminder_minutes == payload.reminder_minutes and (database_utc(current.reminder_at) if current.reminder_at else None) == payload.reminder_at:
        return view(task, preference)
    stamp = reminder_time(configured_task(task, payload), 'task')
    if stamp is not None and stamp <= utcnow():
        raise HTTPException(422, 'Thời điểm thông báo đã qua. Hãy chọn thời gian khác hoặc Không nhắc.')
    if preference is None:
        preference = Preference(task_id=task.id, user_id=user.id)
        db.add(preference)
    preference.reminder_minutes = payload.reminder_minutes
    preference.reminder_at = payload.reminder_at
    preference.version = current_version + 1
    preference.updated_at = utcnow()
    await db.flush()
    await schedule_assignee(db, task, preference)
    mark_changed(db, user.id, 'tasks')
    mark_changed(db, user.id, 'notifications')
    return view(task, preference)

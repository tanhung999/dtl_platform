"""Nghiệp vụ cập nhật dùng chung cho API sửa và dời lịch."""
from datetime import timezone
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import mark_changed
from app.db.models import User, utcnow
from app.modules.tasks.deadlines import VN
from app.modules.tasks.schemas import TaskUpdate
from app.modules.notifications.scheduling import signature, sync_task_jobs
from app.modules.notifications.reminder_fields import reminder_update

from .ownership import owned_task


async def update_task_service(task_id: str, payload: TaskUpdate, user: User, db: AsyncSession, *, record_history=True, allow_elapsed=False):
    if 'is_private' in payload.model_fields_set:
        # Serialize permission changes with assignment/revocation for this owner.
        await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    task = await owned_task(task_id, user, db, lock=True)
    before = {'due_date': task.due_date, 'due_time': task.due_time}
    from app.modules.rescheduling.service import reminder_snapshot
    before.update(reminder_snapshot(task))
    reminder_before = signature(task, 'task')
    data = payload.model_dump(exclude_unset=True)
    data.update(reminder_update(payload))
    from app.modules.access.privacy import require_privacy_change
    if 'is_private' in data:
        await require_privacy_change(db, user.id, data['is_private'], task.is_private)
        if data['is_private'] != task.is_private:
            mark_changed(db, user.id, 'calendar-privacy')
    if data.pop("expected_version") != task.version:
        raise HTTPException(409, "Công việc đã thay đổi. Bản sửa của bạn được giữ; hãy mở lại bản mới trước khi lưu.")
    expected_version = data.pop("expected_deadline_version", None)
    if expected_version is not None and task.deadline_version != expected_version:
        raise HTTPException(status_code=409, detail="Hạn công việc đã thay đổi. Vui lòng thử lại với hạn mới nhất.")
    if "due_date" in data:
        data["due_date"] = payload.due_date.isoformat() if payload.due_date else None
        if data["due_date"] is None and "due_time" not in data:
            data["due_time"] = None
    date_value, time_value = data.get("due_date", task.due_date), data.get("due_time", task.due_time)
    if time_value and not date_value:
        created_at = task.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        date_value = data["due_date"] = created_at.astimezone(VN).date().isoformat()
    if not date_value:
        data.update(reminder_minutes=None, reminder_at=None)
    data = {key: value for key, value in data.items()
            if ((task.description or '') != (value or '') if key == 'description' else getattr(task, key) != value)}
    if not data:
        return task
    if (date_value, time_value) != (task.due_date, task.due_time):
        task.deadline_version += 1
    for key, value in data.items():
        setattr(task, key, value)
    task.version += 1
    task.updated_at = utcnow()
    await db.flush()
    await sync_task_jobs(db, task, before=reminder_before, allow_elapsed=allow_elapsed)
    mark_changed(db, user.id, "notifications")
    mark_changed(db, user.id, "tasks")
    if record_history:
        from app.modules.rescheduling.service import record_change
        await record_change(db, user, 'task', task, before)
    return task

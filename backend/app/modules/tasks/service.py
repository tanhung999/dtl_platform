"""Nghiệp vụ cập nhật dùng chung cho API sửa và dời lịch."""
from datetime import timezone
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import mark_changed
from app.db.models import User, utcnow
from app.modules.tasks.deadlines import VN
from app.modules.tasks.schemas import TaskUpdate
from app.modules.notifications.scheduling import signature, sync_task_jobs
from app.modules.notifications.reminder_fields import reminder_update

from .access import accessible_task
from .permissions import require_assignable_target
from app.db.models import TaskFollower


async def sync_task_followers(db, task, actor, follower_ids):
    """Replace explicit followers while preserving the delegator's tracking link."""
    if len(set(follower_ids)) != len(follower_ids):
        raise HTTPException(422, "Danh sách người theo dõi bị trùng.")
    requested = set(follower_ids) - {task.user_id, task.assignee_id}
    if task.assignee_id != task.user_id:
        requested.add(task.user_id)
    active = set((await db.scalars(select(User.id).where(User.id.in_(requested), User.is_active.is_(True)))).all()) if requested else set()
    if active != requested:
        raise HTTPException(404, "Có người theo dõi không tồn tại hoặc đã ngừng hoạt động.")
    current = set((await db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task.id))).all())
    removed, added = current - requested, requested - current
    if removed:
        await db.execute(delete(TaskFollower).where(TaskFollower.task_id == task.id, TaskFollower.user_id.in_(removed)))
    for user_id in added:
        db.add(TaskFollower(task_id=task.id, user_id=user_id, added_by_id=actor.id))
    return added, removed


async def update_task_service(task_id: str, payload: TaskUpdate, user: User, db: AsyncSession, *, record_history=True, allow_elapsed=False):
    if 'is_private' in payload.model_fields_set:
        # Serialize permission changes with assignment/revocation for this owner.
        await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    task = await accessible_task(task_id, user, db, lock=True)
    owner = task.user_id == user.id
    assignee = task.assignee_id == user.id
    supplied = set(payload.model_fields_set) - {'expected_version', 'expected_deadline_version'}
    if not owner:
        if not assignee or supplied - {'is_completed'}:
            raise HTTPException(403, "Bạn không có quyền sửa nội dung công việc này.")
    if 'assignee_id' in supplied:
        if not owner:
            raise HTTPException(403, "Bạn không có quyền đổi người nhận việc.")
        target = await db.scalar(select(User).where(User.id == payload.assignee_id, User.is_active.is_(True)))
        if not target: raise HTTPException(404, "Không tìm thấy người nhận việc đang hoạt động.")
        await require_assignable_target(db, user, payload.assignee_id)
    before = {'due_date': task.due_date, 'due_time': task.due_time}
    from app.modules.rescheduling.service import reminder_snapshot
    before.update(reminder_snapshot(task))
    reminder_before = signature(task, 'task')
    data = payload.model_dump(exclude_unset=True)
    data.update(reminder_update(payload))
    follower_ids = data.pop('follower_ids', None)
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
    if not date_value and task.due_date and 'reminder_minutes' not in payload.model_fields_set:
        data['reminder_minutes'] = None  # An absolute reminder survives clearing the deadline.
    data = {key: value for key, value in data.items()
            if ((task.description or '') != (value or '') if key == 'description' else getattr(task, key) != value)}
    added_followers = removed_followers = set()
    if follower_ids is not None:
        if not owner:
            raise HTTPException(403, "Bạn không có quyền đổi người theo dõi.")
        added_followers, removed_followers = await sync_task_followers(db, task, user, follower_ids)
    if not data and not added_followers and not removed_followers:
        return task
    if (date_value, time_value) != (task.due_date, task.due_time):
        task.deadline_version += 1
        task.legacy_due_date = None
    old_assignee = task.assignee_id
    for key, value in data.items():
        setattr(task, key, value)
    if task.assignee_id != old_assignee:
        # Assignment changes must keep owner tracking and avoid duplicating the assignee as a follower.
        current_followers = list((await db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task.id))).all())
        more_added, more_removed = await sync_task_followers(db, task, user, current_followers)
        added_followers.update(more_added); removed_followers.update(more_removed)
        from app.modules.collaboration_notifications import notify
        if task.assignee_id != user.id:
            notify(db, task.assignee_id, 'task_reassigned', f'Bạn được giao công việc: {task.title}',
                f'{user.full_name} đã giao công việc cho bạn.', 'task', task.id, task_id=task.id, revision=str(task.version + 1))
            mark_changed(db, task.assignee_id, 'notifications')
        mark_changed(db, old_assignee, 'tasks'); mark_changed(db, task.assignee_id, 'tasks')
    task.version += 1
    task.updated_at = utcnow()
    await db.flush()
    await sync_task_jobs(db, task, before=reminder_before, allow_elapsed=allow_elapsed)
    affected = {task.user_id, task.assignee_id, user.id}
    affected.update(added_followers); affected.update(removed_followers)
    affected.update((await db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task.id))).all())
    for recipient in affected: mark_changed(db, recipient, "tasks")
    mark_changed(db, user.id, "notifications")
    if 'is_completed' in data and task.is_completed and user.id != task.user_id:
        from app.modules.collaboration_notifications import notify
        notify(db, task.user_id, 'task_completed', f'Công việc đã hoàn thành: {task.title}',
            f'{user.full_name} đã đánh dấu hoàn thành.', 'task', task.id, task_id=task.id, revision=str(task.version))
        mark_changed(db, task.user_id, 'notifications')
    if added_followers:
        from app.modules.collaboration_notifications import notify
        for recipient in added_followers - {user.id, task.user_id}:
            notify(db, recipient, 'task_follow_added', f'Bạn được thêm theo dõi: {task.title}',
                f'{user.full_name} đã thêm bạn vào danh sách theo dõi công việc.', 'task', task.id,
                task_id=task.id, revision=str(task.version))
            mark_changed(db, recipient, 'notifications')
    if record_history:
        from app.modules.rescheduling.service import record_change
        await record_change(db, user, 'task', task, before)
    return task

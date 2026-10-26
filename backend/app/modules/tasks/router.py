from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Task, TaskFollower, User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import VN
from app.modules.tasks.schemas import TaskCreate, TaskResponse, TaskUpdate
from app.modules.creation import create_once
from app.modules.notifications.scheduling import sync_task_jobs
from app.db.notifications import Notification, NotificationJob

from .ownership import owned_task
from .access import visible_tasks, accessible_task, serialize_task, serialize_tasks
from app.modules.access.service import MANAGE, has_permission
from .permissions import can_assign_tasks, require_assignable_target, subordinate_ids

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])


CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]




@router.get("", response_model=list[TaskResponse])
async def list_tasks(user: CurrentUser, db: Database, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
    from app.modules.tasks.queries import task_order
    rows = (await db.scalars(select(Task).where(visible_tasks(user.id)).order_by(*task_order(db)).offset(offset).limit(limit))).all()
    return await serialize_tasks(db, rows, user)



# Compatibility endpoints: older clients must not recreate implicit reminders.
@router.get("/reminders", deprecated=True)
async def list_reminders(user: CurrentUser):
    return []


@router.post("/{task_id}/reminders/{kind}/dismiss", deprecated=True)
@router.post("/{task_id}/reminders/{kind}/snooze", deprecated=True)
async def retired_reminder(task_id: str, kind: str, user: CurrentUser):
    raise HTTPException(410, "Thông báo tự động đã ngừng. Hãy chọn thời gian thông báo trong công việc.")


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(payload: TaskCreate, user: CurrentUser, db: Database):
    data = payload.model_dump(exclude={"client_request_id", "follower_ids"})
    data.pop("assignee_id", None)
    async def create():
        from app.modules.access.privacy import require_privacy_change
        await require_privacy_change(db, user.id, payload.is_private)
        created_at = utcnow()
        due_date = payload.due_date or (created_at.astimezone(VN).date() if payload.due_time else None)
        assignee_id = payload.assignee_id or user.id
        assignee = await db.scalar(select(User).where(User.id == assignee_id, User.is_active.is_(True)))
        if assignee is None:
            raise HTTPException(404, "Không tìm thấy người nhận việc đang hoạt động.")
        await require_assignable_target(db, user, assignee_id)
        task = Task(user_id=user.id, assignee_id=assignee_id, created_at=created_at, updated_at=created_at,
                    **{**data, "due_date": due_date.isoformat() if due_date else None})
        db.add(task)
        await db.flush()
        from .service import sync_task_followers
        added_followers, _ = await sync_task_followers(db, task, user, payload.follower_ids)
        if assignee_id != user.id:
            from app.modules.collaboration_notifications import notify
            notify(db, assignee_id, "task_assigned", f"Bạn được giao công việc: {task.title}",
                f"{user.full_name} đã giao công việc cho bạn.", "task", task.id, task_id=task.id)
            mark_changed(db, assignee_id, "tasks"); mark_changed(db, assignee_id, "notifications")
        if added_followers:
            from app.modules.collaboration_notifications import notify
            for recipient in added_followers - {user.id}:
                notify(db, recipient, "task_follow_added", f"Bạn được thêm theo dõi: {task.title}",
                    f"{user.full_name} đã thêm bạn vào danh sách theo dõi công việc.", "task", task.id,
                    task_id=task.id)
                mark_changed(db, recipient, "tasks"); mark_changed(db, recipient, "notifications")
        await sync_task_jobs(db, task, created_at)
        mark_changed(db, user.id, "tasks")
        return task
    fingerprint = {**data, 'assignee_id': payload.assignee_id or user.id, 'follower_ids': sorted(payload.follower_ids)}
    task = await create_once(db, user, "task", payload.client_request_id, {k: v for k, v in fingerprint.items() if k != 'is_private' or v}, Task, create)
    return await serialize_task(db, task, user)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, payload: TaskUpdate, user: CurrentUser, db: Database):
    from .service import update_task_service
    return await serialize_task(db, await update_task_service(task_id, payload, user, db), user)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, user: CurrentUser, db: Database, expected_version: int = Query(ge=0)):
    task = await owned_task(task_id, user, db, lock=True)
    if task.version != expected_version:
        raise HTTPException(409, {"message": "Công việc vừa được cập nhật. Hãy xem bản mới và xác nhận xóa lại.", "current": TaskResponse.model_validate(task).model_dump(mode="json")})
    await db.execute(delete(NotificationJob).where(NotificationJob.task_id == task.id))
    await db.execute(update(Notification).where(Notification.task_id == task.id).values(task_id=None))
    affected = {task.user_id, task.assignee_id}
    affected.update((await db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task.id))).all())
    await db.delete(task)
    for recipient in affected:
        if recipient:
            mark_changed(db, recipient, "tasks")
            mark_changed(db, recipient, "notifications")


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, user: CurrentUser, db: Database):
    return await serialize_task(db, await accessible_task(task_id, user, db), user)


@router.post("/{task_id}/follow", response_model=TaskResponse)
async def follow_task(task_id: str, user: CurrentUser, db: Database):
    task = await accessible_task(task_id, user, db, lock=True)
    existing = await db.scalar(select(TaskFollower).where(TaskFollower.task_id == task.id, TaskFollower.user_id == user.id))
    if not existing:
        db.add(TaskFollower(task_id=task.id, user_id=user.id, added_by_id=user.id)); await db.flush()
        task.version += 1; task.updated_at = utcnow()
        mark_changed(db, user.id, "tasks")
    return await serialize_task(db, task, user)


@router.post("/{task_id}/unfollow", response_model=TaskResponse)
async def unfollow_task(task_id: str, user: CurrentUser, db: Database):
    task = await accessible_task(task_id, user, db, lock=True)
    await db.execute(delete(TaskFollower).where(TaskFollower.task_id == task.id, TaskFollower.user_id == user.id))
    task.version += 1; task.updated_at = utcnow(); mark_changed(db, user.id, "tasks")
    return await serialize_task(db, task, user)


directory_router = APIRouter(prefix="/api/task-assignees", tags=["Tasks"])
colleagues_router = APIRouter(prefix="/api/colleagues", tags=["Directory"])

async def colleague_results(db, q):
    value = q.strip()
    if len(value) < 2: raise HTTPException(422, "Nhập ít nhất 2 ký tự.")
    term = '%' + value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    from sqlalchemy import or_
    rows = (await db.scalars(select(User).where(User.is_active.is_(True), or_(
        User.full_name.ilike(term, escape='\\'), User.username.ilike(term, escape='\\'),
        User.department.ilike(term, escape='\\'))).order_by(User.full_name, User.id).limit(20))).all()
    return [{key:getattr(row,key) for key in ('id','full_name','username','department','job_title','avatar_url')} for row in rows]

@directory_router.get("")
async def task_assignees(user: CurrentUser, db: Database, q: str = Query(min_length=2, max_length=100)):
    if not await can_assign_tasks(db, user):
        raise HTTPException(403, "Bạn không có quyền tìm người nhận việc.")
    rows=await colleague_results(db,q)
    if not await has_permission(db,user.id,MANAGE):
        allowed = await subordinate_ids(db, user.id)
        rows = [row for row in rows if row['id'] in allowed]
    return rows

@colleagues_router.get("")
async def colleagues(user: CurrentUser, db: Database, q: str = Query(min_length=2,max_length=100)):
    return [row for row in await colleague_results(db,q) if row['id'] != user.id]

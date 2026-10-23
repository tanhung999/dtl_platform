from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Task, User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import VN
from app.modules.tasks.schemas import TaskCreate, TaskResponse, TaskUpdate
from app.modules.creation import create_once
from app.modules.notifications.scheduling import sync_task_jobs
from app.db.notifications import Notification, NotificationJob

from .ownership import owned_task

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]




@router.get("", response_model=list[TaskResponse])
async def list_tasks(user: CurrentUser, db: Database, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200)):
    from app.modules.tasks.queries import task_order
    return (await db.scalars(select(Task).where(Task.user_id == user.id).order_by(*task_order(db)).offset(offset).limit(limit))).all()



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
    data = payload.model_dump(exclude={"client_request_id"})
    async def create():
        from app.modules.access.privacy import require_privacy_change
        await require_privacy_change(db, user.id, payload.is_private)
        created_at = utcnow()
        due_date = payload.due_date or (created_at.astimezone(VN).date() if payload.due_time else None)
        task = Task(user_id=user.id, created_at=created_at, updated_at=created_at,
                    **{**data, "due_date": due_date.isoformat() if due_date else None})
        db.add(task)
        await db.flush()
        await sync_task_jobs(db, task, created_at)
        mark_changed(db, user.id, "tasks")
        return task
    return await create_once(db, user, "task", payload.client_request_id, {k: v for k, v in data.items() if k != 'is_private' or v}, Task, create)


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, payload: TaskUpdate, user: CurrentUser, db: Database):
    from .service import update_task_service
    return await update_task_service(task_id, payload, user, db)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, user: CurrentUser, db: Database, expected_version: int = Query(ge=0)):
    task = await owned_task(task_id, user, db, lock=True)
    if task.version != expected_version:
        raise HTTPException(409, {"message": "Công việc vừa được cập nhật. Hãy xem bản mới và xác nhận xóa lại.", "current": TaskResponse.model_validate(task).model_dump(mode="json")})
    await db.execute(delete(NotificationJob).where(NotificationJob.task_id == task.id))
    await db.execute(update(Notification).where(Notification.task_id == task.id).values(task_id=None))
    await db.delete(task)
    mark_changed(db, user.id, "tasks")
    mark_changed(db, user.id, "notifications")


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(task_id: str, user: CurrentUser, db: Database):
    return await owned_task(task_id, user, db)

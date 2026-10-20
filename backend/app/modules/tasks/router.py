from typing import Annotated, Literal
from datetime import timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Task, User, utcnow
from app.db.task_reminders import TaskReminderReceipt
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import active_reminder, task_sort_key, VN
from app.modules.tasks.schemas import ReminderDismiss, ReminderResponse, TaskCreate, TaskResponse, TaskUpdate
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



@router.get("/reminders", response_model=list[ReminderResponse])
async def list_reminders(user: CurrentUser, db: Database):
    now = utcnow().astimezone(timezone.utc)
    day = now.astimezone(VN).date()
    tasks = (await db.execute(select(Task).where(Task.user_id == user.id, Task.is_completed.is_(False), Task.due_date >= day.isoformat(), Task.due_date <= (day + timedelta(days=1)).isoformat()))).scalars().all()
    receipts = (await db.execute(select(TaskReminderReceipt)
                                .join(Task, (Task.id == TaskReminderReceipt.task_id) & (Task.deadline_version == TaskReminderReceipt.deadline_version)).where(Task.user_id == user.id, Task.is_completed.is_(False), Task.due_date >= day.isoformat(), Task.due_date <= (day + timedelta(days=1)).isoformat()))).scalars().all()
    dismissed = {(r.task_id, r.deadline_version, r.kind) for r in receipts if r.snoozed_until is None}
    snoozed = {(r.task_id, r.deadline_version) for r in receipts
               if r.snoozed_until is not None and (r.snoozed_until if r.snoozed_until.tzinfo else r.snoozed_until.replace(tzinfo=timezone.utc)) > now}
    result = []
    for task in sorted(tasks, key=task_sort_key):
        stage = active_reminder(task, now)
        if stage and (task.id, task.deadline_version, stage[0]) not in dismissed and (task.id, task.deadline_version) not in snoozed:
            result.append(ReminderResponse(task_id=task.id, title=task.title, due_date=task.due_date,
                due_time=task.due_time, priority=task.priority, deadline_version=task.deadline_version,
                kind=stage[0], scheduled_at=stage[1]))
    return result


@router.post("/{task_id}/reminders/{kind}/dismiss", status_code=204)
async def dismiss_reminder(task_id: str, kind: Literal["before", "day"], payload: ReminderDismiss, user: CurrentUser, db: Database):
    task = await owned_task(task_id, user, db, lock=True)
    if task.deadline_version != payload.deadline_version:
        raise HTTPException(status_code=409, detail="Hạn đã thay đổi. Vui lòng tải lại nhắc hạn.")
    stmt = select(TaskReminderReceipt).where(TaskReminderReceipt.task_id == task_id,
        TaskReminderReceipt.deadline_version == payload.deadline_version, TaskReminderReceipt.kind == kind)
    receipt = (await db.execute(stmt)).scalar_one_or_none()
    if receipt is None:
        db.add(TaskReminderReceipt(task_id=task_id, deadline_version=payload.deadline_version, kind=kind))
    else:
        receipt.snoozed_until = None
        receipt.dismissed_at = utcnow()
    await db.flush()
    mark_changed(db, user.id, "tasks")


@router.post("/{task_id}/reminders/{kind}/snooze", status_code=204)
async def snooze_reminder(task_id: str, kind: Literal["before", "day"], payload: ReminderDismiss, user: CurrentUser, db: Database):
    task = await owned_task(task_id, user, db, lock=True)
    if task.deadline_version != payload.deadline_version:
        raise HTTPException(status_code=409, detail="Hạn đã thay đổi. Vui lòng tải lại nhắc hạn.")
    now = utcnow().astimezone(timezone.utc)
    stage = active_reminder(task, now)
    if not stage or stage[0] != kind:
        raise HTTPException(status_code=409, detail="Nhắc hạn đã thay đổi. Vui lòng tải lại.")
    stmt = select(TaskReminderReceipt).where(TaskReminderReceipt.task_id == task_id,
        TaskReminderReceipt.deadline_version == payload.deadline_version, TaskReminderReceipt.kind == kind)
    receipt = (await db.execute(stmt)).scalar_one_or_none()
    if receipt is None:
        receipt = TaskReminderReceipt(task_id=task_id, deadline_version=payload.deadline_version, kind=kind)
        db.add(receipt)
    receipt.snoozed_until = now + timedelta(hours=1)
    await db.flush()
    mark_changed(db, user.id, "tasks")


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

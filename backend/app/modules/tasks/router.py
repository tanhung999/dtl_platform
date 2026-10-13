from typing import Annotated, Literal
from datetime import timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Task, User, utcnow
from app.db.task_reminders import TaskReminderReceipt
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import active_reminder, task_sort_key, VN
from app.modules.tasks.schemas import ReminderDismiss, ReminderResponse, TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db)]


async def owned_task(task_id: str, user: User, db: AsyncSession, *, lock=False):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    task = (await db.execute(stmt)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
    return task


@router.get("", response_model=list[TaskResponse])
async def list_tasks(user: CurrentUser, db: Database):
    tasks = (await db.execute(select(Task).where(Task.user_id == user.id))).scalars().all()
    return sorted(tasks, key=task_sort_key)


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
    data = payload.model_dump()
    created_at = utcnow()
    due_date = payload.due_date or (created_at.astimezone(VN).date() if payload.due_time else None)
    data["due_date"] = due_date.isoformat() if due_date else None
    task = Task(user_id=user.id, created_at=created_at, updated_at=created_at, **data)
    db.add(task)
    await db.flush()
    mark_changed(db, user.id, "tasks")
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(task_id: str, payload: TaskUpdate, user: CurrentUser, db: Database):
    task = await owned_task(task_id, user, db, lock=True)
    data = payload.model_dump(exclude_unset=True)
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
    if (date_value, time_value) != (task.due_date, task.due_time):
        task.deadline_version += 1
    for key, value in data.items():
        setattr(task, key, value)
    task.updated_at = utcnow()
    await db.flush()
    mark_changed(db, user.id, "tasks")
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: str, user: CurrentUser, db: Database):
    task = await owned_task(task_id, user, db, lock=True)
    await db.delete(task)
    mark_changed(db, user.id, "tasks")

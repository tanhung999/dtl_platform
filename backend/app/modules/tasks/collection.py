"""Bounded To-Do pages, date-scoped calendar reads and scheduled reminder checks."""
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.text_search import fold_text
from app.db.models import Task, User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import VN
from app.modules.tasks.schemas import TaskResponse
from .queries import overdue_condition, task_order, after_task

router = APIRouter(prefix="/api/tasks", tags=["Tasks"])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope="function")]
TaskFilter = Literal["ALL", "PENDING", "DONE", "OVERDUE"]

@router.get("/collection")
async def collection(user: UserArg, db: DbArg, filter: TaskFilter = "ALL", offset: int = Query(0, ge=0), limit: int = Query(25, ge=1, le=100), overdue_offset: int = Query(0, ge=0), after: str | None = Query(None, max_length=64), overdue_after: str | None = Query(None, max_length=64), q: str = Query('', max_length=200)):
    now = utcnow()
    local = now.astimezone(VN)
    overdue = overdue_condition(now)
    owned = Task.user_id == user.id
    counts = (await db.execute(select(func.count(), func.count().filter(Task.is_completed.is_(False)), func.count().filter(overdue),
        func.min(Task.due_time).filter(Task.is_completed.is_(False), Task.due_date == local.date(), Task.due_time > local.strftime("%H:%M")),
        func.count().filter(Task.is_completed.is_(False), Task.due_date.is_not(None))).where(owned))).one()
    total, pending, late, next_clock, dated_pending = counts
    checks = [datetime.combine(local.date() + timedelta(days=1), time.min, VN)] if dated_pending else []
    if next_clock:
        checks.append(datetime.combine(local.date(), time.fromisoformat(str(next_clock)), VN))
    next_refresh = min(checks).astimezone(timezone.utc) if checks else None
    conditions = {"ALL": owned, "PENDING": and_(owned, Task.is_completed.is_(False)), "DONE": and_(owned, Task.is_completed.is_(True)), "OVERDUE": and_(owned, overdue)}
    count = {"ALL": total, "PENDING": pending, "DONE": total - pending, "OVERDUE": late}[filter]
    condition = conditions[filter]
    keyword = fold_text(q)
    if keyword:
        condition = and_(condition, Task.search_text.contains(keyword, autoescape=True) if len(keyword) >= 2 else False)
        count = await db.scalar(select(func.count()).select_from(Task).where(condition))
    requested_offset, requested_overdue_offset = offset, overdue_offset
    offset = min(offset, ((count - 1) // limit) * limit) if count else 0
    overdue_offset = min(overdue_offset, ((late - 1) // 25) * 25) if late else 0
    stmt = select(Task).where(condition).order_by(*task_order(db))
    stmt = stmt.where(await after_task(db, user.id, after)) if after and offset and offset == requested_offset else stmt.offset(offset)
    items = (await db.scalars(stmt.limit(limit))).all()
    late_stmt = select(Task).where(owned, overdue).order_by(*task_order(db))
    late_stmt = late_stmt.where(await after_task(db, user.id, overdue_after)) if overdue_after and overdue_offset and overdue_offset == requested_overdue_offset else late_stmt.offset(overdue_offset)
    late_items = (await db.scalars(late_stmt.limit(25))).all()
    return {"server_now": now, "next_refresh_at": next_refresh, "items": [TaskResponse.model_validate(t) for t in items], "overdue": [TaskResponse.model_validate(t) for t in late_items],
            "counts": {"ALL": total, "PENDING": pending, "DONE": total-pending, "OVERDUE": late},
            "offset": offset, "limit": limit, "total": count, "has_more": offset + limit < count,
            "next_cursor": f'{items[-1].id}:{items[-1].version}' if items and offset + limit < count else None,
            "overdue_next_cursor": f'{late_items[-1].id}:{late_items[-1].version}' if late_items and overdue_offset + 25 < late else None,
            "overdue_offset": overdue_offset, "overdue_has_more": overdue_offset + 25 < late}

@router.get("/calendar", response_model=list[TaskResponse])
async def calendar_tasks(user: UserArg, db: DbArg, start: date, end: date):
    if end <= start or (end - start).days > 93:
        raise HTTPException(422, "Khoảng xem phải lớn hơn 0 và tối đa 93 ngày.")
    return (await db.scalars(select(Task).where(Task.user_id == user.id, Task.due_date >= start, Task.due_date < end).order_by(*task_order(db)).limit(500))).all()

@router.get("/calendar/page")
async def calendar_page(user: UserArg, db: DbArg, start: date, end: date, limit: int = Query(500, ge=1, le=500)):
    if end <= start or (end - start).days > 93:
        raise HTTPException(422, "Khoảng xem phải lớn hơn 0 và tối đa 93 ngày.")
    owned = (Task.user_id == user.id, Task.due_date >= start, Task.due_date < end)
    total = await db.scalar(select(func.count()).select_from(Task).where(*owned))
    from sqlalchemy.orm import defer
    rows = (await db.scalars(select(Task).options(defer(Task.description)).where(*owned).order_by(*task_order(db)).limit(limit))).all()
    items = [{name: getattr(row, name) for name in TaskResponse.model_fields if name != "description"} | {"description": None} for row in rows]
    return {"items": items, "total": total, "truncated": total > len(items)}

@router.get("/reminders/schedule", deprecated=True)
async def reminder_schedule(user: UserArg):
    return {"items": [], "next_check_at": None, "server_now": utcnow()}

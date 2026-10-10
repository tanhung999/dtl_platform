from typing import Annotated, List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, asc, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.db.models import Task, User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.schemas import TaskCreate, TaskResponse, TaskUpdate

router = APIRouter(prefix="/api/tasks", tags=["Tasks (Start.me Style)"])


@router.get("", response_model=List[TaskResponse])
async def list_tasks(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = (
        select(Task)
        .where(Task.user_id == user.id)
        .order_by(asc(Task.is_completed), asc(Task.display_order), desc(Task.created_at))
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    payload: TaskCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    task = Task(
        user_id=user.id,
        title=payload.title.strip(),
        description=payload.description,
        priority=payload.priority or "MEDIUM",
        due_date=payload.due_date,
        is_completed=False,
    )
    db.add(task)
    await db.flush()
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: str,
    payload: TaskUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy công việc")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)
    task.updated_at = utcnow()
    await db.flush()
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy công việc")
    await db.delete(task)
    return None

"""Tra cứu tài nguyên thuộc chủ sở hữu."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import User, Task

async def owned_task(task_id: str, user: User, db: AsyncSession, *, lock=False):
    stmt = select(Task).where(Task.id == task_id, Task.user_id == user.id)
    if lock:
        stmt = stmt.with_for_update()
    task = (await db.execute(stmt)).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy công việc.")
    return task

"""Tra cứu tài nguyên thuộc chủ sở hữu."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import User
from .access import accessible_task

async def owned_task(task_id: str, user: User, db: AsyncSession, *, lock=False):
    task = await accessible_task(task_id, user, db, lock=lock)
    if task.user_id != user.id:
        raise HTTPException(status_code=403, detail="Chỉ người tạo được thực hiện thao tác này.")
    return task

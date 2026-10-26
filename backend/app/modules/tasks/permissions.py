"""Organization-aware authorization for task delegation."""
from fastapi import HTTPException
from sqlalchemy import select

from app.db.models import User
from app.db.organization import JobLevel, Position
from app.modules.access.service import MANAGE, TASKS_ASSIGN, has_permission


async def subordinate_ids(db, manager_id: str) -> set[str]:
    """Return direct and indirect active reports, safely handling legacy cycles."""
    found: set[str] = set()
    frontier = {manager_id}
    while frontier:
        children = set((await db.scalars(select(User.id).where(
            User.manager_id.in_(frontier), User.is_active.is_(True)
        ))).all()) - found
        found.update(children)
        frontier = children - {manager_id}
    found.discard(manager_id)
    return found


async def can_assign_tasks(db, user: User) -> bool:
    if await has_permission(db, user.id, TASKS_ASSIGN):
        return True
    if not user.position_id:
        return False
    return bool(await db.scalar(
        select(JobLevel.is_management)
        .join(Position, Position.job_level_id == JobLevel.id)
        .where(Position.id == user.position_id, Position.is_active.is_(True), JobLevel.is_active.is_(True))
    ))


async def require_assignable_target(db, actor: User, target_id: str) -> None:
    if target_id == actor.id:
        return
    if not await can_assign_tasks(db, actor):
        raise HTTPException(403, "Bạn không có quyền giao công việc cho người khác.")
    if await has_permission(db, actor.id, MANAGE):
        return
    if target_id not in await subordinate_ids(db, actor.id):
        raise HTTPException(403, "Bạn chỉ có thể giao công việc cho nhân viên thuộc tuyến quản lý của mình.")

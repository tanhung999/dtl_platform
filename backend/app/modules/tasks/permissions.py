"""Account-level delegation scoped to active departments, independent of job titles."""
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.core.realtime import mark_changed
from app.db.access import AccessAccountVersion, UserRole
from app.db.models import User
from app.db.organization import Department, Position, TaskAssignmentDepartment, TaskAssignmentPolicy
from app.modules.access.audit import record
from app.modules.access.service import CAPABILITY_ROLES, MANAGE, TASKS_ASSIGN, has_permission


async def current_department_id(db, user):
    if not user.position_id:
        return None
    return await db.scalar(select(Department.id).join(Position, Position.department_id == Department.id)
        .where(Position.id == user.position_id, Position.is_active.is_(True), Department.is_active.is_(True)))


async def assignment_department_ids(db, user):
    if not await has_permission(db, user.id, TASKS_ASSIGN):
        return set()
    department_id = await current_department_id(db, user)
    if department_id is None:
        return set()
    policy = await db.get(TaskAssignmentPolicy, user.id)
    if policy is None:
        return {department_id}
    if not policy.enabled or policy.home_department_id != department_id:
        return set()
    if policy.mode == 'current_department':
        return {department_id}
    return set((await db.scalars(select(Department.id).join(TaskAssignmentDepartment,
        TaskAssignmentDepartment.department_id == Department.id).where(
            TaskAssignmentDepartment.user_id == user.id, Department.is_active.is_(True)))).all())


async def can_assign_tasks(db, user):
    return await has_permission(db, user.id, MANAGE) or bool(await assignment_department_ids(db, user))


def department_recipient_ids(department_ids):
    return select(User.id).join(Position, User.position_id == Position.id).join(
        Department, Department.id == Position.department_id).where(User.is_active.is_(True),
        Position.is_active.is_(True), Department.is_active.is_(True), Department.id.in_(department_ids))


async def require_assignable_target(db, actor: User, target_id: str):
    if target_id == actor.id:
        return
    locked = {row.id: row for row in (await db.scalars(select(User).where(User.id.in_({actor.id, target_id})).order_by(User.id)
        .with_for_update().execution_options(populate_existing=True))).all()}
    if target_id not in locked or not locked[target_id].is_active:
        raise HTTPException(404, 'Không tìm thấy người nhận việc đang hoạt động.')
    if not actor.is_active:
        raise HTTPException(403, 'Tài khoản của bạn không còn hoạt động.')
    if await has_permission(db, actor.id, MANAGE):
        return
    departments = await assignment_department_ids(db, actor)
    if not departments:
        raise HTTPException(403, 'Bạn chưa được cấp quyền giao việc hoặc chưa có phòng ban hợp lệ.')
    if not await db.scalar(department_recipient_ids(departments).where(User.id == target_id)):
        raise HTTPException(403, 'Bạn chỉ được giao việc trong các phòng ban đã được cấp phép.')


async def revoke_assignment_on_department_change(db, target, actor):
    """Revoke explicit delegation, preserving administrator and task ownership rights."""
    policy = await db.get(TaskAssignmentPolicy, target.id)
    had_grant = await has_permission(db, target.id, TASKS_ASSIGN)
    if policy is None:
        policy = TaskAssignmentPolicy(user_id=target.id, enabled=False, mode='current_department')
        db.add(policy)
    else:
        policy.enabled = False
        policy.mode = 'current_department'
        policy.home_department_id = None
    await db.execute(delete(TaskAssignmentDepartment).where(TaskAssignmentDepartment.user_id == target.id))
    await db.execute(delete(UserRole).where(UserRole.user_id == target.id,
        UserRole.role_id == CAPABILITY_ROLES[TASKS_ASSIGN]))
    state = await db.get(AccessAccountVersion, target.id)
    if state is None:
        db.add(AccessAccountVersion(user_id=target.id, version=1))
    else:
        state.version += 1
    if had_grant:
        record(db, actor, target, 'task_assignment_revoked_department_change', {'reason': 'department_changed'})
    mark_changed(db, target.id, 'calendar-sharing')
    mark_changed(db, target.id, 'tasks')
    mark_changed(db, actor.id, 'calendar-sharing')

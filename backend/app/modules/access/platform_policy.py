"""Explicit, versioned Platform capabilities backed by the existing RBAC tables."""
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Literal
from sqlalchemy import delete, select, update

from app.core.realtime import mark_changed
from app.db.access import AccessAccountVersion, AccessRole, CalendarShare, RolePermission, UserRole
from app.db.models import User, utcnow
from app.db.organization import Department, TaskAssignmentDepartment, TaskAssignmentPolicy
from app.modules.tasks.permissions import can_assign_tasks, current_department_id
from .audit import record
from .service import CAPABILITY_ROLES, MANAGE, PLATFORM_PERMISSIONS, SHARE, TASKS_ASSIGN, effective_permissions, require


class AssignmentScope(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['current_department', 'selected_departments'] = 'current_department'
    department_ids: list[str] = Field(default_factory=list, max_length=500)

    def normalized(self):
        return {'mode': self.mode, 'department_ids': sorted(set(self.department_ids)) if self.mode == 'selected_departments' else []}


class PlatformPolicyWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    permissions: list[str] = Field(max_length=3)
    expected_permissions: list[str] = Field(max_length=3)
    expected_version: int = Field(ge=0)
    assignment_scope: AssignmentScope | None = None


async def policy_view(db, target):
    permissions = (await effective_permissions(db, target.id)) & PLATFORM_PERMISSIONS.keys()
    state = await db.get(AccessAccountVersion, target.id)
    policy = await db.get(TaskAssignmentPolicy, target.id)
    selected = sorted((await db.scalars(select(TaskAssignmentDepartment.department_id).where(
        TaskAssignmentDepartment.user_id == target.id))).all()) if policy and policy.enabled else []
    departments = (await db.scalars(select(Department).order_by(Department.name, Department.id))).all()
    return {'permissions': sorted(permissions), 'access_version': state.version if state else 0,
            'can_assign_tasks': await can_assign_tasks(db, target),
            'assignment_scope': {'mode': policy.mode if policy and policy.enabled else 'current_department', 'department_ids': selected},
            'home_department_id': await current_department_id(db, target),
            'departments': [{'id': row.id, 'name': row.name, 'is_active': row.is_active} for row in departments]}


async def save_policy(db, actor, target_id, payload):
    # Serialize administration changes before locking individual accounts.
    await require(db, actor.id, MANAGE)
    await db.scalar(select(AccessRole).where(AccessRole.id == 'access_admin').with_for_update())
    await require(db, actor.id, MANAGE)
    if not await db.scalar(select(User.id).where(User.id == actor.id, User.is_active.is_(True))):
        raise HTTPException(403, 'Tài khoản của bạn không còn hoạt động.')
    target = await db.scalar(select(User).where(User.id == target_id, User.is_active.is_(True)).with_for_update())
    if not target:
        raise HTTPException(404, 'Không tìm thấy tài khoản đang hoạt động.')
    desired, expected = set(payload.permissions), set(payload.expected_permissions)
    if (desired | expected) - PLATFORM_PERMISSIONS.keys():
        raise HTTPException(422, 'Danh sách quyền Platform không hợp lệ.')
    current = await policy_view(db, target)
    scope = payload.assignment_scope.normalized() if payload.assignment_scope else current['assignment_scope']
    if TASKS_ASSIGN not in desired:
        scope = AssignmentScope().normalized()
    if current['access_version'] == payload.expected_version + 1 and set(current['permissions']) == desired and current['assignment_scope'] == scope:
        return current
    if current['access_version'] != payload.expected_version or set(current['permissions']) != expected:
        raise HTTPException(409, 'Quyền vừa thay đổi. Hãy tải lại và kiểm tra trước khi lưu.')
    if desired == expected and scope == current['assignment_scope']:
        return current
    home = await current_department_id(db, target)
    if TASKS_ASSIGN in desired:
        if home is None and MANAGE not in desired:
            raise HTTPException(422, 'Hãy gán vị trí thuộc một phòng ban đang hoạt động trước khi cấp quyền giao việc.')
        if scope['mode'] == 'selected_departments':
            ids = scope['department_ids']
            active = set((await db.scalars(select(Department.id).where(Department.id.in_(ids), Department.is_active.is_(True)))).all())
            if not ids or set(ids) != active:
                raise HTTPException(422, 'Chọn ít nhất một phòng ban đang hoạt động để giao việc.')
    if actor.id == target_id and MANAGE not in desired:
        raise HTTPException(422, 'Không thể tự thu hồi quyền quản trị Platform của chính mình.')
    managed = {'access_admin', 'calendar_sharer', *CAPABILITY_ROLES.values()}
    extended_role = await db.scalar(select(RolePermission.role_id)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .where(UserRole.user_id == target_id, UserRole.role_id.in_(managed),
               RolePermission.permission_code.not_in(PLATFORM_PERMISSIONS)).limit(1))
    if extended_role:
        raise HTTPException(409, 'Vai trò hiện tại có quyền mở rộng. Cần kiểm tra cấu hình vai trò trước khi thay đổi.')
    inherited = set((await db.scalars(select(RolePermission.permission_code)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .where(UserRole.user_id == target_id, UserRole.role_id.not_in(managed)))).all()) & PLATFORM_PERMISSIONS.keys()
    inherited.discard(TASKS_ASSIGN)  # Its per-account grant can be revoked without removing unrelated roles.
    if inherited - desired:
        raise HTTPException(409, 'Một số quyền được cấp qua vai trò khác. Hãy điều chỉnh vai trò đó trước.')
    await db.execute(delete(UserRole).where(UserRole.user_id == target_id, UserRole.role_id.in_(managed)))
    db.add_all([UserRole(user_id=target_id, role_id=CAPABILITY_ROLES[code]) for code in sorted(desired - inherited)])
    policy = await db.get(TaskAssignmentPolicy, target_id)
    if policy is None:
        policy = TaskAssignmentPolicy(user_id=target_id)
        db.add(policy)
    policy.enabled = TASKS_ASSIGN in desired
    policy.mode = scope['mode']
    policy.home_department_id = home if policy.enabled else None
    await db.flush()
    await db.execute(delete(TaskAssignmentDepartment).where(TaskAssignmentDepartment.user_id == target_id))
    if policy.enabled and scope['mode'] == 'selected_departments':
        db.add_all([TaskAssignmentDepartment(user_id=target_id, department_id=identifier) for identifier in scope['department_ids']])
    if SHARE in expected and SHARE not in desired:
        viewers = (await db.scalars(select(CalendarShare.viewer_id).where(
            CalendarShare.owner_id == target_id, CalendarShare.revoked_at.is_(None)))).all()
        await db.execute(update(CalendarShare).where(CalendarShare.owner_id == target_id,
            CalendarShare.revoked_at.is_(None)).values(revoked_at=utcnow(), updated_at=utcnow(), version=CalendarShare.version + 1))
        for viewer in viewers:
            mark_changed(db, viewer, 'shared-calendar')
            mark_changed(db, viewer, 'calendar-sharing')
    state = await db.get(AccessAccountVersion, target_id)
    if state is None:
        state = AccessAccountVersion(user_id=target_id, version=0)
        db.add(state)
    state.version += 1
    record(db, actor, target, 'platform_permissions_updated', {
        'before': sorted(expected), 'after': sorted(desired), 'version': state.version,
        'scope_before': current['assignment_scope'], 'scope_after': scope,
        'scope_department_names': [item['name'] for item in current['departments'] if item['id'] in scope['department_ids']]})
    mark_changed(db, target_id, 'calendar-sharing')
    mark_changed(db, actor.id, 'calendar-sharing')
    await db.flush()
    return await policy_view(db, target)

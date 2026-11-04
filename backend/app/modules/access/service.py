"""Database-backed permissions; JWT and legacy display roles grant no capabilities."""
from sqlalchemy import select
from fastapi import HTTPException
from app.db.access import AccessRole, AccessPermission, RolePermission, UserRole
from app.db.organization import TaskAssignmentPolicy

MANAGE = 'access.assignments.manage'
SHARE = 'calendar.share.manage'
APPLICATIONS_MANAGE = 'applications.manage'
TASKS_ASSIGN = 'tasks.assign'

PLATFORM_PERMISSIONS = {
    MANAGE: 'Quản trị Platform',
    SHARE: 'Chia sẻ lịch cá nhân',
    TASKS_ASSIGN: 'Giao công việc cho nhân viên',
}
CAPABILITY_ROLES = {code: 'platform_' + code.replace('.', '_') for code in PLATFORM_PERMISSIONS}

def permission_users(code):
    statement = select(UserRole.user_id).join(RolePermission, RolePermission.role_id == UserRole.role_id).where(RolePermission.permission_code == code)
    if code == TASKS_ASSIGN:
        statement = statement.where(UserRole.user_id.not_in(select(TaskAssignmentPolicy.user_id).where(TaskAssignmentPolicy.enabled.is_(False))))
    return statement

async def has_permission(db, user_id, code):
    return bool(await db.scalar(select(permission_users(code).where(UserRole.user_id == user_id).exists())))

async def effective_permissions(db, user_id):
    permissions = set((await db.scalars(select(RolePermission.permission_code)
        .join(UserRole, UserRole.role_id == RolePermission.role_id)
        .where(UserRole.user_id == user_id).distinct())).all())
    policy = await db.get(TaskAssignmentPolicy, user_id)
    if policy is not None and not policy.enabled:
        permissions.discard(TASKS_ASSIGN)
    return permissions

async def require(db, user_id, code):
    if not await has_permission(db, user_id, code):
        raise HTTPException(403, 'Bạn không có quyền thực hiện thao tác này.')

async def seed_catalog(db):
    for key, name in [('access_admin', 'Quản lý cấp quyền'), ('calendar_sharer', 'Chia sẻ lịch cá nhân')]:
        if not await db.get(AccessRole, key): db.add(AccessRole(id=key, name=name))
    for code, name in PLATFORM_PERMISSIONS.items():
        permission = await db.get(AccessPermission, code)
        if permission is None:
            db.add(AccessPermission(code=code, name=name))
        else:
            permission.name = name
        role_id = CAPABILITY_ROLES[code]
        if not await db.get(AccessRole, role_id):
            db.add(AccessRole(id=role_id, name=name))
    await db.flush()
    for role, code in [
        ('access_admin', MANAGE),
        ('access_admin', TASKS_ASSIGN),
        ('calendar_sharer', SHARE),
    ] + [(role, code) for code, role in CAPABILITY_ROLES.items()]:
        if not await db.get(RolePermission, (role, code)): db.add(RolePermission(role_id=role, permission_code=code))
    await db.flush()

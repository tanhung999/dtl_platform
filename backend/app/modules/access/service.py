"""Database-backed permissions; JWT and legacy display roles grant no capabilities."""
from sqlalchemy import select
from fastapi import HTTPException
from app.db.access import AccessRole, AccessPermission, RolePermission, UserRole

MANAGE = 'access.assignments.manage'
SHARE = 'calendar.share.manage'
APPLICATIONS_MANAGE = 'applications.manage'

def permission_users(code):
    return select(UserRole.user_id).join(RolePermission, RolePermission.role_id == UserRole.role_id).where(RolePermission.permission_code == code)

async def has_permission(db, user_id, code):
    return bool(await db.scalar(select(permission_users(code).where(UserRole.user_id == user_id).exists())))

async def require(db, user_id, code):
    if not await has_permission(db, user_id, code):
        raise HTTPException(403, 'Bạn không có quyền thực hiện thao tác này.')

async def seed_catalog(db):
    for key, name in [('access_admin', 'Quản lý cấp quyền'), ('calendar_sharer', 'Chia sẻ lịch cá nhân')]:
        if not await db.get(AccessRole, key): db.add(AccessRole(id=key, name=name))
    for code, name in [
        (MANAGE, 'Cấp quyền chia sẻ lịch'),
        (SHARE, 'Chia sẻ lịch của mình'),
        (APPLICATIONS_MANAGE, 'Quản lý ứng dụng và quyền truy cập ứng dụng'),
    ]:
        if not await db.get(AccessPermission, code): db.add(AccessPermission(code=code, name=name))
    await db.flush()
    for role, code in [
        ('access_admin', MANAGE),
        ('access_admin', APPLICATIONS_MANAGE),
        ('calendar_sharer', SHARE),
    ]:
        if not await db.get(RolePermission, (role, code)): db.add(RolePermission(role_id=role, permission_code=code))
    await db.flush()

"""Unify administration without elevating former application-only managers."""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, select

from app.db.access import AccessAccountVersion, AccessPermission, AccessRole, RolePermission, UserRole
from app.modules.access.service import seed_catalog

RETIRED_PERMISSIONS = ('users.manage', 'organization.manage', 'applications.manage')


async def migrate_platform_permissions(conn):
    async with AsyncSession(bind=conn) as db:
        await seed_catalog(db)
        affected_users = set((await db.scalars(select(UserRole.user_id)
            .join(RolePermission, RolePermission.role_id == UserRole.role_id)
            .where(RolePermission.permission_code.in_(RETIRED_PERMISSIONS)).distinct())).all())
        await db.execute(delete(RolePermission).where(RolePermission.permission_code.in_(RETIRED_PERMISSIONS)))
        await db.execute(delete(AccessPermission).where(AccessPermission.code.in_(RETIRED_PERMISSIONS)))
        for code in RETIRED_PERMISSIONS:
            role_id = 'platform_' + code.replace('.', '_')
            # Retain roles carrying unrelated extensions, but retire empty generated roles.
            if not await db.scalar(select(RolePermission.role_id).where(RolePermission.role_id == role_id).limit(1)):
                await db.execute(delete(UserRole).where(UserRole.role_id == role_id))
                await db.execute(delete(AccessRole).where(AccessRole.id == role_id))
        for user_id in affected_users:
            state = await db.get(AccessAccountVersion, user_id)
            if state is None:
                db.add(AccessAccountVersion(user_id=user_id, version=1))
            else:
                state.version += 1
        await db.flush()

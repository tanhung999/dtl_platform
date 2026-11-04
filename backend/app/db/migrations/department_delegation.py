"""Retire reporting hierarchies and bind explicit delegation to the current department."""
from sqlalchemy import inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.access import AccessAccountVersion, RolePermission, UserRole
from app.db.models import User
from app.db.organization import Department, Position, TaskAssignmentPolicy


async def migrate_department_delegation(conn):
    for table, column in (('positions', 'job_level_id'), ('users', 'manager_id')):
        columns = await conn.run_sync(lambda sync, table=table: {c['name'] for c in inspect(sync).get_columns(table)})
        if column in columns:
            await conn.execute(text(f'ALTER TABLE {table} DROP COLUMN {column}'))
    await conn.execute(text('DROP TABLE IF EXISTS job_level_report_targets'))
    await conn.execute(text('DROP TABLE IF EXISTS job_levels'))
    async with AsyncSession(bind=conn) as db:
        users = (await db.scalars(select(User).where(User.id.in_(select(UserRole.user_id).join(
            RolePermission, RolePermission.role_id == UserRole.role_id).where(
                RolePermission.permission_code == 'tasks.assign'))))).all()
        positions = {row.id: row for row in (await db.scalars(select(Position))).all()}
        departments = {row.id for row in (await db.scalars(select(Department).where(Department.is_active.is_(True)))).all()}
        for user in users:
            if await db.get(TaskAssignmentPolicy, user.id) is not None:
                continue
            position = positions.get(user.position_id)
            home = position.department_id if position and position.is_active and position.department_id in departments else None
            db.add(TaskAssignmentPolicy(user_id=user.id, enabled=home is not None,
                mode='current_department', home_department_id=home))
            state = await db.get(AccessAccountVersion, user.id)
            if state is None:
                db.add(AccessAccountVersion(user_id=user.id, version=1))
            else:
                state.version += 1
        await db.flush()

"""Seed the separately scoped cross-department follower capability."""
from sqlalchemy.ext.asyncio import AsyncSession
from app.modules.access.service import seed_catalog


async def migrate_follower_department_scope(conn):
    async with AsyncSession(bind=conn) as db:
        await seed_catalog(db)
        await db.flush()

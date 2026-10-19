"""Quyền nền tảng và chia sẻ lịch chỉ xem, không tự cấp quyền chia sẻ."""
from sqlalchemy import inspect, text

async def migrate_calendar_privacy(conn):
    tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
    if 'calendar_events' in tables:
        columns = await conn.run_sync(lambda c: {x['name'] for x in inspect(c).get_columns('calendar_events')})
        if 'is_private' not in columns:
            await conn.execute(text('ALTER TABLE calendar_events ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE'))

async def migrate_access_catalog(conn):
    from sqlalchemy.ext.asyncio import AsyncSession
    from app.modules.access.service import seed_catalog
    from app.db.access import UserRole
    async with AsyncSession(bind=conn) as db:
        await seed_catalog(db)
        # One-time bootstrap of the existing installation administrator, not a business role rule.
        user_id = await db.scalar(text("SELECT id FROM users WHERE username='admin' AND is_active=true"))
        if user_id and not await db.get(UserRole, (user_id, 'access_admin')):
            db.add(UserRole(user_id=user_id, role_id='access_admin'))
        await db.flush()

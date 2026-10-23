"""Add origin metadata without rewriting existing notification history."""
from sqlalchemy import inspect, text


async def migrate_shared_notifications(conn):
    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('notifications')})
    if 'calendar_owner_id' not in columns:
        await conn.execute(text('ALTER TABLE notifications ADD COLUMN calendar_owner_id VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE'))
    await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_notifications_calendar_owner_id ON notifications (calendar_owner_id)'))

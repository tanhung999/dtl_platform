"""Giữ dữ liệu cũ; trạng thái riêng tư của lịch hẹn được chuyển sang Notes."""
from sqlalchemy import inspect, text


async def migrate_item_privacy(conn):
    for table in ('tasks', 'notes'):
        columns = await conn.run_sync(lambda sync: {col['name'] for col in inspect(sync).get_columns(table)})
        if 'is_private' not in columns:
            await conn.execute(text(f'ALTER TABLE {table} ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT FALSE'))
    await conn.execute(text('''UPDATE notes SET is_private=TRUE WHERE is_private=FALSE AND id IN
        (SELECT s.note_id FROM note_calendar_schedules s JOIN calendar_events e ON e.id=s.event_id WHERE e.is_private=TRUE)'''))

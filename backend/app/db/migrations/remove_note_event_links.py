"""Gỡ bảng liên kết nhiều–nhiều cũ, giữ ghi chú, sự kiện và lịch hẹn riêng."""
from sqlalchemy import text, inspect

async def migrate_remove_note_event_links(conn):
    await conn.execute(text("DROP TABLE IF EXISTS calendar_event_notes"))
    await conn.execute(text("DROP INDEX IF EXISTS ix_calendar_search_trgm"))
    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('calendar_events')})
    if 'search_title' in columns:
        await conn.execute(text("ALTER TABLE calendar_events DROP COLUMN search_title"))

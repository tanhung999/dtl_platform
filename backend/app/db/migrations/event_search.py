"""Backfill event search in bounded batches; reuse existing pg_trgm support."""
from sqlalchemy import inspect, text
from app.core.text_search import fold_text


async def migrate_event_search(conn):
    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('calendar_events')})
    if 'search_text' not in columns:
        await conn.execute(text("ALTER TABLE calendar_events ADD COLUMN search_text TEXT NOT NULL DEFAULT ''"))
    last = ''
    while True:
        rows = (await conn.execute(text('SELECT id, title, description, location FROM calendar_events WHERE id > :last ORDER BY id LIMIT 500'), {'last': last})).mappings().all()
        if not rows:
            break
        await conn.execute(text('UPDATE calendar_events SET search_text=:value WHERE id=:id'),
            [{'id': row['id'], 'value': fold_text(f"{row['title'] or ''}\n{row['description'] or ''}\n{row['location'] or ''}")} for row in rows])
        last = rows[-1]['id']
    if conn.dialect.name == 'postgresql':
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
        await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_calendar_events_search_trgm ON calendar_events USING gin (search_text gin_trgm_ops)'))

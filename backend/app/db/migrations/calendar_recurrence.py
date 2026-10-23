from sqlalchemy import inspect, text

async def migrate_calendar_recurrence(conn):
    columns = await conn.run_sync(lambda sync: {col['name'] for col in inspect(sync).get_columns('calendar_events')})
    if 'recurrence' not in columns:
        await conn.execute(text("ALTER TABLE calendar_events ADD COLUMN recurrence VARCHAR(10) NOT NULL DEFAULT 'NONE'"))

    if 'recurrence_until' not in columns:
        stamp_type = 'TIMESTAMP WITH TIME ZONE' if conn.dialect.name == 'postgresql' else 'DATETIME'
        await conn.execute(text(f'ALTER TABLE calendar_events ADD COLUMN recurrence_until {stamp_type}'))

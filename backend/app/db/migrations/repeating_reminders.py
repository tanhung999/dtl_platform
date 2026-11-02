"""Opt-in repeating reminders, retaining the behavior of existing schedules."""
from sqlalchemy import inspect, text


async def migrate_repeating_reminders(conn):
    columns = await conn.run_sync(lambda sync: {item['name'] for item in inspect(sync).get_columns('calendar_events')})
    if 'reminder_repeat' in columns:
        return
    await conn.execute(text('ALTER TABLE calendar_events ADD COLUMN reminder_repeat BOOLEAN NOT NULL DEFAULT FALSE'))
    # Previously, only relative reminders repeated. Do not silently stop them.
    await conn.execute(text("UPDATE calendar_events SET reminder_repeat=TRUE WHERE recurrence IN ('DAILY','WEEKLY') AND reminder_minutes IS NOT NULL"))

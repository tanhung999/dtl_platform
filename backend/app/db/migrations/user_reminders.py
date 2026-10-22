"""Chuyển sang một lần nhắc do người dùng chọn; giữ lịch sử đã gửi."""
from sqlalchemy import inspect, text
from app.db.notifications import Notification, NotificationJob


async def migrate_user_reminders(conn):
    pg = conn.dialect.name == 'postgresql'
    for table in ('tasks', 'calendar_events'):
        columns = await conn.run_sync(lambda sync, table=table: {c['name'] for c in inspect(sync).get_columns(table)})
        for name, definition in [('reminder_minutes', 'INTEGER'), ('reminder_at', 'TIMESTAMP WITH TIME ZONE' if pg else 'DATETIME'),
                                 ('reminder_version', 'INTEGER NOT NULL DEFAULT 0')]:
            if name not in columns:
                await conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {definition}'))
    columns = await conn.run_sync(lambda sync: {c['name']: c for c in inspect(sync).get_columns('notification_jobs')})
    if not pg and not columns['task_id']['nullable']:
        await conn.execute(text('ALTER TABLE notification_jobs RENAME TO notification_jobs_legacy'))
        await conn.execute(text('''CREATE TABLE notification_jobs (
            id VARCHAR(36) PRIMARY KEY, task_id VARCHAR(36) REFERENCES tasks(id) ON DELETE CASCADE,
            event_id VARCHAR(36) REFERENCES calendar_events(id) ON DELETE CASCADE, reminder_version INTEGER,
            user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE, deadline_version INTEGER NOT NULL,
            kind VARCHAR(20) NOT NULL, event_key VARCHAR(200) NOT NULL UNIQUE, scheduled_at DATETIME NOT NULL,
            available_at DATETIME NOT NULL, processed_at DATETIME)'''))
        await conn.execute(text('''INSERT INTO notification_jobs
            (id,task_id,user_id,deadline_version,kind,event_key,scheduled_at,available_at,processed_at)
            SELECT id,task_id,user_id,deadline_version,kind,event_key,scheduled_at,available_at,processed_at FROM notification_jobs_legacy'''))
        await conn.execute(text('DROP TABLE notification_jobs_legacy'))
    else:
        if pg:
            await conn.execute(text('ALTER TABLE notification_jobs ALTER COLUMN task_id DROP NOT NULL'))
        for name, definition in [('event_id', 'VARCHAR(36) REFERENCES calendar_events(id) ON DELETE CASCADE'), ('reminder_version', 'INTEGER')]:
            if name not in columns:
                await conn.execute(text(f'ALTER TABLE notification_jobs ADD COLUMN {name} {definition}'))
    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('notifications')})
    for name, definition in [('event_id', 'VARCHAR(36) REFERENCES calendar_events(id) ON DELETE SET NULL'), ('reminder_version', 'INTEGER')]:
        if name not in columns:
            await conn.execute(text(f'ALTER TABLE notifications ADD COLUMN {name} {definition}'))
    # Old implicit reminders must never be delivered after upgrading.
    await conn.execute(text("DELETE FROM notification_jobs WHERE processed_at IS NULL AND reminder_version IS NULL"))
    for table in (Notification.__table__, NotificationJob.__table__):
        present = await conn.run_sync(lambda sync, name=table.name: {c['name'] for c in inspect(sync).get_columns(name)})
        for index in table.indexes:
            if not {c.name for c in index.columns} <= present:
                continue  # A later migration may add columns from the current model.
            await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))

"""Versioned upgrades restricted to tasks, reminders and calendar events."""
from sqlalchemy import inspect, text
from app.core.database import Base, engine
from app.db import models, calendar, task_reminders, workspace_layout
from .task_deadlines import migrate_task_deadlines
from .task_reminder_snooze import migrate_task_reminder_snooze

TABLES = ('tasks', 'task_reminder_receipts', 'calendar_events')

async def task_calendar_schema(conn):
    if conn.dialect.name == 'postgresql':
        for column, datatype in [('due_date', 'DATE'), ('due_time', 'TIME WITHOUT TIME ZONE')]:
            await conn.execute(text(f"ALTER TABLE tasks ALTER COLUMN {column} TYPE {datatype} USING NULLIF({column}::text, '')::{datatype}"))
        for name in TABLES:
            table = Base.metadata.tables[name]
            old = await conn.run_sync(lambda sync, name=name: {c['name']: c for c in inspect(sync).get_columns(name)})
            for column in table.columns:
                if not column.nullable and old[column.name]['nullable']:
                    default = column.default.arg if column.default is not None else None
                    if callable(default):
                        await conn.execute(text(f'UPDATE {name} SET {column.name} = CURRENT_TIMESTAMP WHERE {column.name} IS NULL'))
                    elif default is not None:
                        await conn.execute(text(f'UPDATE {name} SET {column.name} = :value WHERE {column.name} IS NULL'), {'value': default})
                    await conn.execute(text(f'ALTER TABLE {name} ALTER COLUMN {column.name} SET NOT NULL'))
            checks = await conn.run_sync(lambda sync, name=name: {c['name'] for c in inspect(sync).get_check_constraints(name)})
            for constraint in table.constraints:
                if getattr(constraint, 'sqltext', None) is not None and constraint.name not in checks:
                    await conn.execute(text(f'ALTER TABLE {name} ADD CONSTRAINT {constraint.name} CHECK ({constraint.sqltext})'))
    for name in TABLES:
        for index in Base.metadata.tables[name].indexes:
            await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))

async def upgrade(conn):
    if conn.dialect.name == 'postgresql':
        await conn.execute(text('SELECT pg_advisory_xact_lock(721042026)'))
    await migrate_task_deadlines(conn)
    await migrate_task_reminder_snooze(conn)
    await conn.run_sync(Base.metadata.create_all)
    await conn.execute(text('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'))
    version = 'task_calendar_001_native_deadlines'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await task_calendar_schema(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

async def run():
    try:
        async with engine.begin() as conn:
            await upgrade(conn)
    finally:
        await engine.dispose()

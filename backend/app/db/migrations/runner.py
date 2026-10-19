"""Versioned schema upgrades and workspace order data cleanup."""
from sqlalchemy import inspect, text
from app.core.database import Base, engine
from app.db import models, calendar, task_reminders, workspace_layout
from app.db import note_scheduling
from app.db import create_requests
from app.db import access
from app.db import workspace_versions
from .sharing_reliability import migrate_sharing_reliability
from .calendar_sharing import migrate_calendar_privacy, migrate_access_catalog
from app.db import notifications
from .notifications import migrate_notifications
from .task_deadlines import migrate_task_deadlines
from .task_reminder_snooze import migrate_task_reminder_snooze
from .workspace_order_cleanup import migrate_workspace_order_cleanup
from .widget_layout import migrate_widget_layout
from .note_versions import migrate_note_versions
from .remove_note_event_links import migrate_remove_note_event_links
from .note_scheduling import migrate_note_scheduling
from .note_reliability import migrate_note_reliability
from .collection_scaling import migrate_collection_scaling
from .collection_reliability import migrate_collection_reliability

TABLES = ('tasks', 'task_reminder_receipts', 'calendar_events')

async def task_calendar_schema(conn):
    if conn.dialect.name == 'postgresql':
        for column, datatype in [('due_date', 'DATE'), ('due_time', 'TIME WITHOUT TIME ZONE')]:
            await conn.execute(text(f"ALTER TABLE tasks ALTER COLUMN {column} TYPE {datatype} USING NULLIF({column}::text, '')::{datatype}"))
        for name in TABLES:
            table = Base.metadata.tables[name]
            old = await conn.run_sync(lambda sync, name=name: {c['name']: c for c in inspect(sync).get_columns(name)})
            for column in table.columns:
                if column.name in old and not column.nullable and old[column.name]['nullable']:
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
    await migrate_calendar_privacy(conn)
    await conn.run_sync(Base.metadata.create_all)
    # workspace_versions is additive; existing accounts begin at zero until their next write.
    await conn.execute(text('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'))
    version = 'task_calendar_001_native_deadlines'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await task_calendar_schema(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'workspace_001_prune_order_ids'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_workspace_order_cleanup(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'workspace_002_widget_layout'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_widget_layout(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'calendar_notes_001_links_and_version'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_note_versions(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notes_001_reliable_creation_search'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_note_reliability(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'collections_001_versions_order_search'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_collection_scaling(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'collections_002_reliability_sorted_tasks'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_collection_reliability(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notifications_001_persistent_inbox'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_notifications(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'calendar_notes_002_note_schedules'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_note_scheduling(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notes_002_remove_event_links'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await migrate_remove_note_event_links(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'access_001_readonly_calendar_sharing'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        await migrate_access_catalog(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'access_002_sharing_reliability_audit'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        await migrate_sharing_reliability(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'realtime_001_scope_versions'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        await conn.run_sync(lambda sync: workspace_versions.WorkspaceVersion.__table__.create(sync, checkfirst=True))
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

async def run():
    try:
        async with engine.begin() as conn:
            await upgrade(conn)
    finally:
        await engine.dispose()

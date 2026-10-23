"""Versioned schema upgrades and workspace order data cleanup."""
from sqlalchemy import inspect, text
from app.core.database import Base, engine
from app.db import models, calendar
from app.db import note_scheduling
from app.db import create_requests
from app.db import access
from app.db import workspace_versions
from app.db import schedule_changes
from .sharing_reliability import migrate_sharing_reliability
from .calendar_sharing import migrate_calendar_privacy, migrate_access_catalog
from app.db import notifications
from app.db import calendar_exceptions
from .notifications import migrate_notifications
from .task_deadlines import migrate_task_deadlines
from .note_versions import migrate_note_versions
from .remove_note_event_links import migrate_remove_note_event_links
from .note_scheduling import migrate_note_scheduling
from .note_reliability import migrate_note_reliability
from .collection_scaling import migrate_collection_scaling
from .collection_reliability import migrate_collection_reliability

TABLES = ('tasks', 'calendar_events')

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
    await migrate_calendar_privacy(conn)
    await conn.run_sync(Base.metadata.create_all)
    from .calendar_recurrence import migrate_calendar_recurrence
    await migrate_calendar_recurrence(conn)
    # workspace_versions is additive; existing accounts begin at zero until their next write.
    await conn.execute(text('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)'))
    await conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('calendar_001_recurrence') ON CONFLICT (version) DO NOTHING"))
    await conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('calendar_003_occurrence_exceptions') ON CONFLICT (version) DO NOTHING"))
    await conn.execute(text("INSERT INTO schema_migrations (version) VALUES ('calendar_004_scoped_recurrence') ON CONFLICT (version) DO NOTHING"))
    version = 'task_calendar_001_native_deadlines'
    applied = await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version})
    if not applied:
        await task_calendar_schema(conn)
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

    version = 'workspace_003_remove_drag_and_drop'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .remove_drag_and_drop import migrate_remove_drag_and_drop
        await migrate_remove_drag_and_drop(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'tasks_001_server_search'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .task_search import migrate_task_search
        await migrate_task_search(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'sharing_003_task_note_privacy'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .item_privacy import migrate_item_privacy
        await migrate_item_privacy(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'scheduling_001_change_history'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        await conn.run_sync(lambda sync: schedule_changes.ScheduleChange.__table__.create(sync, checkfirst=True))
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'maintenance_001_retention_receipts'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .retention import migrate_retention
        await migrate_retention(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notifications_002_user_selected_reminders'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .user_reminders import migrate_user_reminders
        await migrate_user_reminders(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notifications_003_retire_implicit_receipts'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .retire_reminder_receipts import migrate_retire_reminder_receipts
        await migrate_retire_reminder_receipts(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notifications_004_shared_calendar_reminders'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .shared_notifications import migrate_shared_notifications
        await migrate_shared_notifications(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'notifications_005_standalone_note_reminders'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .standalone_reminders import migrate_standalone_reminders
        await migrate_standalone_reminders(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'calendar_002_server_search'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .event_search import migrate_event_search
        await migrate_event_search(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'tasks_003_three_priority_levels'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .task_priorities import migrate_task_priorities
        await migrate_task_priorities(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

    version = 'tasks_004_resolved_legacy_dates'
    if not await conn.scalar(text('SELECT version FROM schema_migrations WHERE version=:version'), {'version': version}):
        from .resolved_legacy_dates import migrate_resolved_legacy_dates
        await migrate_resolved_legacy_dates(conn)
        await conn.execute(text('INSERT INTO schema_migrations (version) VALUES (:version)'), {'version': version})

async def run():
    try:
        async with engine.begin() as conn:
            await upgrade(conn)
    finally:
        await engine.dispose()

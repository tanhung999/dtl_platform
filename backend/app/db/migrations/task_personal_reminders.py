"""Add independent assignee reminders and optional completion metadata, retaining all rows."""
from sqlalchemy import inspect, text


async def migrate_task_personal_reminders(conn):
    from app.db.notifications import TaskReminderPreference
    for table, additions in {
        'tasks': {
            'completion_note': 'VARCHAR(500)',
            'completed_at': 'TIMESTAMP WITH TIME ZONE' if conn.dialect.name == 'postgresql' else 'DATETIME',
            'completed_by_id': 'VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL',
        },
        'notification_jobs': {'recipient_id': 'VARCHAR(36) REFERENCES users(id) ON DELETE CASCADE'},
    }.items():
        columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns(table)})
        for name, definition in additions.items():
            if name not in columns:
                await conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {definition}'))
    # Old items never appeared in collaborators' shared calendars. Preserve that
    # boundary; only new items (or an explicit owner edit) permit indirect reads.
    for table in ('tasks', 'calendar_events'):
        columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns(table)})
        if 'hide_from_indirect' not in columns:
            await conn.execute(text(f'ALTER TABLE {table} ADD COLUMN hide_from_indirect BOOLEAN NOT NULL DEFAULT FALSE'))
            await conn.execute(text(f'UPDATE {table} SET hide_from_indirect=TRUE'))
    await conn.run_sync(lambda sync: TaskReminderPreference.__table__.create(sync, checkfirst=True))

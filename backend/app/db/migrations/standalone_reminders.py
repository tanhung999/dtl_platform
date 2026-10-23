"""Allow a Note to remind without inventing a calendar appointment."""
from sqlalchemy import inspect, text


async def migrate_standalone_reminders(conn):
    definitions = {
        'notes': [('reminder_at', 'TIMESTAMP WITH TIME ZONE' if conn.dialect.name == 'postgresql' else 'DATETIME'),
                  ('reminder_version', 'INTEGER NOT NULL DEFAULT 0')],
        'notification_jobs': [('note_id', 'VARCHAR(36) REFERENCES notes(id) ON DELETE CASCADE')],
        'notifications': [('note_id', 'VARCHAR(36) REFERENCES notes(id) ON DELETE SET NULL')],
    }
    for table, fields in definitions.items():
        present = await conn.run_sync(lambda sync, table=table: {c['name'] for c in inspect(sync).get_columns(table)})
        for name, definition in fields:
            if name not in present:
                await conn.execute(text(f'ALTER TABLE {table} ADD COLUMN {name} {definition}'))
        if table != 'notes':
            await conn.execute(text(f'CREATE INDEX IF NOT EXISTS ix_{table}_note_id ON {table} (note_id)'))

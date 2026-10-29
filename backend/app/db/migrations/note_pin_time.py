"""Track pin actions without treating later content edits as new pins."""
from sqlalchemy import inspect, text


async def migrate_note_pin_time(conn):
    tables = await conn.run_sync(lambda sync: inspect(sync).get_table_names())
    if 'notes' not in tables:
        return
    columns = await conn.run_sync(lambda sync: {column['name'] for column in inspect(sync).get_columns('notes')})
    if 'pinned_at' not in columns:
        stamp_type = 'TIMESTAMP WITH TIME ZONE' if conn.dialect.name == 'postgresql' else 'DATETIME'
        await conn.execute(text(f'ALTER TABLE notes ADD COLUMN pinned_at {stamp_type}'))
        # Historical pin times were never recorded. Preserve the existing
        # creation order for these rows until the next explicit pin action.
        await conn.execute(text('UPDATE notes SET pinned_at = COALESCE(created_at, updated_at, CURRENT_TIMESTAMP) WHERE is_pinned = true'))
    # Keep this expression index out of model metadata: SQLite cannot reflect
    # it for the checkfirst index creation used by older upgrade steps.
    await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_notes_owner_pin_time ON notes (user_id, is_archived, is_pinned, COALESCE(pinned_at, created_at) DESC, created_at DESC, id)'))

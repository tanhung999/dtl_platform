"""Gỡ dữ liệu bố cục/thứ tự kéo thả; giữ nguyên các bản ghi nghiệp vụ."""
from sqlalchemy import inspect, text
from app.core.database import Base
from .collection_reliability import migrate_collection_reliability


async def migrate_remove_drag_and_drop(conn):
    for name in ('workspace_layouts', 'workspace_widget_layouts'):
        await conn.execute(text(f'DROP TABLE IF EXISTS {name}'))
    # Drop only the indexes that depend on obsolete manual ranks.
    for name in ('ix_notes_owner_order', 'ix_notes_owner_feed', 'ix_tasks_owner_sorted'):
        await conn.execute(text(f'DROP INDEX IF EXISTS {name}'))
    for table, names in (
        ('notes', ('sort_order',)),
        ('tasks', ('display_order',)),
        ('bookmarks', ('display_order',)),
        ('workspace_versions', ('layout', 'widget_layout')),
    ):
        columns = await conn.run_sync(lambda sync, table=table: {c['name'] for c in inspect(sync).get_columns(table)})
        for name in names:
            if name in columns:
                await conn.execute(text(f'ALTER TABLE {table} DROP COLUMN {name}'))
    for index in Base.metadata.tables['notes'].indexes:
        await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))
    await migrate_collection_reliability(conn)

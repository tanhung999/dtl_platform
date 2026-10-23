"""Merge the former high and medium task levels without changing deadlines."""
from sqlalchemy import text


async def migrate_task_priorities(conn):
    await conn.execute(text("UPDATE tasks SET priority='MEDIUM', version=version+1, updated_at=CURRENT_TIMESTAMP WHERE priority='HIGH'"))
    # Invalidate old cursors and cached collections after the priority merge.
    await conn.execute(text("UPDATE workspace_versions SET tasks=tasks+1, shared_calendar=shared_calendar+1"))

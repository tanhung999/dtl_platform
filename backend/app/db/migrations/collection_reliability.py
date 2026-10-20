"""Add the measured task ordering index; preserve existing range/count indexes."""
from sqlalchemy import text


async def migrate_collection_reliability(conn):
    if conn.dialect.name != 'postgresql':
        return
    await conn.execute(text("""CREATE INDEX IF NOT EXISTS ix_tasks_owner_sorted
        ON tasks (user_id, is_completed,
          (due_date + CASE WHEN due_time IS NULL THEN 1 ELSE 0 END) ASC NULLS LAST,
          (COALESCE(due_time, '00:00'::time)),
          (CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 3 ELSE 4 END),
          id)"""))

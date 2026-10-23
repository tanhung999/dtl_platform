"""Discard only legacy date hints whose schedules have already been resolved."""
from sqlalchemy import text


async def migrate_resolved_legacy_dates(conn):
    await conn.execute(text("""UPDATE tasks SET legacy_due_date=NULL, version=version+1,
        updated_at=CURRENT_TIMESTAMP WHERE legacy_due_date IS NOT NULL
        AND (due_date IS NOT NULL OR deadline_version>0)"""))

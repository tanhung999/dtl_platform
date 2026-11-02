"""Retain existing completion results without changing task data."""
from sqlalchemy import text
from app.db.task_history import TaskResultHistory


async def migrate_task_result_history(conn):
    await conn.run_sync(lambda sync: TaskResultHistory.__table__.create(sync, checkfirst=True))
    await conn.execute(text("""
        INSERT INTO task_result_history (id, task_id, task_version, actor_id, action, note, occurred_at, is_snapshot)
        SELECT 'snapshot:' || t.id, t.id, t.version, t.completed_by_id, 'COMPLETED', t.completion_note, t.completed_at, TRUE
        FROM tasks t WHERE t.is_completed = TRUE
          AND NOT EXISTS (SELECT 1 FROM task_result_history h WHERE h.task_id = t.id)
    """))

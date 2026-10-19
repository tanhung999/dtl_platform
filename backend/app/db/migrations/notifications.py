"""Bootstrap pending reminders in bounded batches; no invented notification history."""
from types import SimpleNamespace
from sqlalchemy import select
from app.db.models import Task, utcnow
from app.db.notifications import NotificationJob
from app.modules.notifications.scheduling import plan
from app.modules.notifications.service import insert_unique

async def migrate_notifications(conn):
    last, now = '', utcnow()
    while True:
        rows = (await conn.execute(select(Task.id, Task.user_id, Task.due_date, Task.due_time, Task.deadline_version, Task.is_completed)
            .where(Task.id > last, Task.due_date.is_not(None), Task.is_completed.is_(False)).order_by(Task.id).limit(250))).mappings().all()
        if not rows:
            break
        jobs = [job for row in rows for job in plan(SimpleNamespace(**row), now)]
        await insert_unique(conn, NotificationJob, jobs, ['event_key'])
        last = rows[-1]['id']

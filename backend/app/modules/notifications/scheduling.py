"""Build only future stages and the latest current reminder; no per-user polling."""
from datetime import date, datetime, time, timedelta, timezone
from sqlalchemy import delete
from app.db.models import utcnow
from app.db.notifications import NotificationJob
from app.modules.tasks.deadlines import VN, active_reminder, deadline_at
from .service import insert_unique

def plan(task, now):
    due = deadline_at(task)
    if task.is_completed or not due:
        return []
    day = date.fromisoformat(task.due_date)
    stages = {'before': datetime.combine(day - timedelta(days=1), time(8), VN),
              'day': min(datetime.combine(day, time(8), VN), due - timedelta(minutes=30)) if task.due_time else datetime.combine(day, time(8), VN), 'overdue': due}
    active = active_reminder(task, now)
    current = 'overdue' if now >= due else active[0] if active else None
    return [dict(task_id=task.id, user_id=task.user_id, deadline_version=task.deadline_version, kind=kind,
        event_key=f'task:{task.id}:{task.deadline_version}:{kind}', scheduled_at=stamp.astimezone(timezone.utc), available_at=max(stamp, now).astimezone(timezone.utc))
        for kind, stamp in stages.items() if stamp > now or kind == current]

async def sync_task_jobs(db, task, now=None):
    now = now or utcnow()
    # Keep delivered receipts; preserve a current snooze through title/priority edits.
    stale = (NotificationJob.deadline_version != task.deadline_version) | (NotificationJob.kind != 'snooze')
    if task.is_completed or not task.due_date:
        stale = True
    await db.execute(delete(NotificationJob).where(NotificationJob.task_id == task.id, NotificationJob.processed_at.is_(None), stale))
    await insert_unique(db, NotificationJob, plan(task, now), ['event_key'])

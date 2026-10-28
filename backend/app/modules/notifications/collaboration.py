"""Active assignees and explicit followers eligible for scheduled reminders."""
from sqlalchemy import select
from app.db.models import Task, TaskFollower, User
from app.db.calendar import CalendarEventFollower


async def reminder_recipients(db, task_ids, event_ids):
    result = {}
    if task_ids:
        assignments = (await db.execute(select(Task.id, Task.assignee_id).join(User, User.id == Task.assignee_id)
            .where(Task.id.in_(task_ids), User.is_active.is_(True)))).all()
        followers = (await db.execute(select(TaskFollower.task_id, TaskFollower.user_id).join(User, User.id == TaskFollower.user_id)
            .where(TaskFollower.task_id.in_(task_ids), User.is_active.is_(True)))).all()
        for resource, recipient in [*assignments, *followers]:
            result.setdefault(('task', resource), set()).add(recipient)
    if event_ids:
        followers = (await db.execute(select(CalendarEventFollower.event_id, CalendarEventFollower.user_id)
            .join(User, User.id == CalendarEventFollower.user_id)
            .where(CalendarEventFollower.event_id.in_(event_ids), User.is_active.is_(True)))).all()
        for resource, recipient in followers:
            result.setdefault(('event', resource), set()).add(recipient)
    return result

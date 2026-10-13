from datetime import date, datetime, time, timedelta, timezone
from app.db.models import Task

VN = timezone(timedelta(hours=7))
PRIORITIES = {"URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}


def deadline_at(task: Task) -> datetime | None:
    if not task.due_date:
        return None
    day = date.fromisoformat(task.due_date)
    if task.due_time:
        return datetime.combine(day, time.fromisoformat(task.due_time), VN)
    return datetime.combine(day + timedelta(days=1), time.min, VN)


def task_sort_key(task: Task):
    due = deadline_at(task)
    return (task.is_completed, due is None, due.timestamp() if due else float("inf"),
            PRIORITIES.get(task.priority, 2), task.display_order or 0, task.id)


def active_reminder(task: Task, now: datetime):
    due = deadline_at(task)
    if task.is_completed or due is None or now >= due:
        return None
    day = date.fromisoformat(task.due_date)
    before = datetime.combine(day - timedelta(days=1), time(8), VN)
    morning = datetime.combine(day, time(8), VN)
    if task.due_time:
        morning = min(morning, due - timedelta(minutes=30))
    if now >= morning:
        return "day", morning
    if now >= before:
        return "before", before
    return None

"""Independent calendar visibility for received assignments and other tasks."""
from typing import Literal

from sqlalchemy import and_, true

from app.db.models import Task

CalendarTaskGroup = Literal["all", "assigned", "other", "none"]


def received_assignment(user_id):
    return and_(Task.assignee_id.is_not(None), Task.assignee_id == user_id, Task.user_id != user_id)


def calendar_task_group(user_id, group: CalendarTaskGroup):
    assigned = received_assignment(user_id)
    return {"all": true(), "assigned": assigned, "other": ~assigned, "none": False}[group]

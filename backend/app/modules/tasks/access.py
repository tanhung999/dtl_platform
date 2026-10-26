"""Visibility, authorization and response metadata for delegated tasks."""
from sqlalchemy import or_, select
from fastapi import HTTPException

from app.db.models import Task, TaskFollower, User
from app.modules.tasks.schemas import TaskResponse
from .permissions import can_assign_tasks


def visible_tasks(user_id):
    followed = select(TaskFollower.task_id).where(TaskFollower.user_id == user_id)
    return or_(Task.user_id == user_id, Task.assignee_id == user_id, Task.id.in_(followed))


async def accessible_task(task_id, user, db, *, lock=False):
    statement = select(Task).where(Task.id == task_id, visible_tasks(user.id))
    if lock:
        statement = statement.with_for_update()
    task = await db.scalar(statement)
    if task is None:
        raise HTTPException(404, "Không tìm thấy công việc.")
    return task


def brief(user):
    if not user:
        return None
    return {key: getattr(user, key) for key in ("id", "full_name", "username", "department", "job_title", "avatar_url")}


async def serialize_tasks(db, tasks, viewer):
    tasks = list(tasks)
    if not tasks:
        return []
    task_ids = [task.id for task in tasks]
    follower_rows = (await db.execute(select(TaskFollower.task_id, TaskFollower.user_id)
        .where(TaskFollower.task_id.in_(task_ids)))).all()
    follower_map = {}
    for task_id, user_id in follower_rows:
        follower_map.setdefault(task_id, []).append(user_id)
    user_ids = {task.user_id for task in tasks} | {task.assignee_id for task in tasks}
    user_ids.update(user_id for _, user_id in follower_rows)
    users = {row.id: row for row in (await db.scalars(select(User).where(User.id.in_(user_ids)))).all()}
    assign = await can_assign_tasks(db, viewer)
    result = []
    for task in tasks:
        followers = follower_map.get(task.id, [])
        owner = task.user_id == viewer.id
        assignee = task.assignee_id == viewer.id
        following = viewer.id in followers
        relationship = "OWNER" if owner else "ASSIGNEE" if assignee else "FOLLOWER" if following else None
        value = TaskResponse.model_validate(task).model_dump()
        value.update(creator=brief(users.get(task.user_id)), assignee=brief(users.get(task.assignee_id)),
            followers=[brief(users.get(item)) for item in followers if users.get(item)], is_following=following,
            relationship=relationship, can_edit=owner, can_complete=owner or assignee,
            can_delete=owner, can_assign=owner and assign)
        result.append(value)
    return result


async def serialize_task(db, task, viewer):
    return (await serialize_tasks(db, [task], viewer))[0]

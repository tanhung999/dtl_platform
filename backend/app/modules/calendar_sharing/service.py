"""All shared reads pass the same live grant, owner and capability checks."""
from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import aliased
from app.db.access import CalendarShare
from app.db.models import User, Task, TaskFollower
from app.db.calendar import CalendarEvent as Event, CalendarEventFollower
from app.modules.access.service import SHARE, permission_users


def calendar_task_scope(owner_id):
    followed = select(TaskFollower.task_id).where(TaskFollower.user_id == owner_id).correlate_except(TaskFollower)
    return or_(Task.user_id == owner_id, and_(Task.hide_from_indirect.is_(False),
               or_(Task.assignee_id == owner_id, Task.id.in_(followed))))


def calendar_event_scope(owner_id):
    followed = select(CalendarEventFollower.event_id).where(CalendarEventFollower.user_id == owner_id).correlate_except(CalendarEventFollower)
    return or_(Event.user_id == owner_id, and_(Event.hide_from_indirect.is_(False), Event.id.in_(followed)))


def shared_calendar_for(viewer_id, kind):
    """An actual grant, never a chain of calendar grants."""
    holder = aliased(User)
    model, scope = (Task, calendar_task_scope) if kind == 'task' else (Event, calendar_event_scope)
    return select(CalendarShare.owner_id).join(holder, holder.id == CalendarShare.owner_id).where(
        CalendarShare.viewer_id == viewer_id, CalendarShare.revoked_at.is_(None), holder.is_active.is_(True),
        CalendarShare.owner_id.in_(permission_users(SHARE)),
        getattr(CalendarShare, 'share_tasks' if kind == 'task' else 'share_events').is_(True),
        scope(CalendarShare.owner_id), model.is_private.is_(False),
    ).order_by(CalendarShare.owner_id).limit(1).correlate(model).scalar_subquery()


def shared_owner_ids(viewer_id, scope):
    """Owners whose live grant permits this category, matching grant_for."""
    return select(CalendarShare.owner_id).join(User, User.id == CalendarShare.owner_id).where(
        CalendarShare.viewer_id == viewer_id, CalendarShare.revoked_at.is_(None),
        getattr(CalendarShare, scope).is_(True), User.is_active.is_(True),
        User.id.in_(permission_users(SHARE)))

async def grant_for(db, owner_id, viewer_id):
    grant = await db.scalar(select(CalendarShare).join(User, User.id == CalendarShare.owner_id).where(
        CalendarShare.owner_id == owner_id, CalendarShare.viewer_id == viewer_id, CalendarShare.revoked_at.is_(None),
        User.is_active.is_(True), User.id.in_(permission_users(SHARE))))
    if not grant: raise HTTPException(404, 'Lịch không còn được chia sẻ với bạn.')
    return grant

async def lock_owner(db, owner_id):
    return await db.scalar(select(User).where(User.id == owner_id).with_for_update())

def flags(row):
    return {key: getattr(row, key) for key in ('share_events', 'share_tasks', 'share_notes')}

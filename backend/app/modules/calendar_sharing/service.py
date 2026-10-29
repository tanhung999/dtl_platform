"""All shared reads pass the same live grant, owner and capability checks."""
from fastapi import HTTPException
from sqlalchemy import select
from app.db.access import CalendarShare
from app.db.models import User
from app.modules.access.service import SHARE, permission_users


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

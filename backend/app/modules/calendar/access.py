"""Explicit follower visibility and metadata for calendar events."""
from sqlalchemy import or_, select
from fastapi import HTTPException
from app.db.calendar import CalendarEvent, CalendarEventFollower
from app.db.models import User


def visible_events(user_id):
    return or_(CalendarEvent.user_id == user_id, CalendarEvent.id.in_(
        select(CalendarEventFollower.event_id).where(CalendarEventFollower.user_id == user_id)))


async def visible_event(db, event_id, user, *, lock=False):
    query = select(CalendarEvent).where(CalendarEvent.id == event_id, visible_events(user.id))
    if lock: query = query.with_for_update()
    event = await db.scalar(query)
    if not event: raise HTTPException(404, "Không tìm thấy sự kiện.")
    return event


def user_brief(row):
    return {key:getattr(row,key) for key in ('id','full_name','username','department','job_title','avatar_url')} if row else None


async def event_metadata(db, event, viewer):
    follower_ids = list((await db.scalars(select(CalendarEventFollower.user_id).where(CalendarEventFollower.event_id == event.id))).all())
    users = {row.id:row for row in (await db.scalars(select(User).where(User.id.in_({event.user_id, *follower_ids})))).all()}
    owner = event.user_id == viewer.id
    return {'followers':[user_brief(users.get(item)) for item in follower_ids if users.get(item)],
        'is_following':viewer.id in follower_ids, 'can_edit':owner, 'can_delete':owner,
        'owner':user_brief(users.get(event.user_id))}


async def sync_followers(db, event, actor, follower_ids):
    if event.scheduled_note_id and follower_ids:
        raise HTTPException(422, "Sự kiện liên kết từ ghi chú cá nhân không hỗ trợ thêm người theo dõi.")
    requested = set(follower_ids) - {event.user_id}
    if len(requested) != len(follower_ids) - (1 if event.user_id in follower_ids else 0):
        raise HTTPException(422, "Danh sách người theo dõi bị trùng.")
    active = set((await db.scalars(select(User.id).where(User.id.in_(requested), User.is_active.is_(True)))).all()) if requested else set()
    if active != requested: raise HTTPException(404, "Có người theo dõi không tồn tại hoặc đã ngừng hoạt động.")
    current = set((await db.scalars(select(CalendarEventFollower.user_id).where(CalendarEventFollower.event_id == event.id))).all())
    from sqlalchemy import delete
    removed, added = current-requested, requested-current
    if removed: await db.execute(delete(CalendarEventFollower).where(CalendarEventFollower.event_id == event.id, CalendarEventFollower.user_id.in_(removed)))
    for user_id in added:
        db.add(CalendarEventFollower(event_id=event.id,user_id=user_id,added_by_id=actor.id))
    return added, removed

"""Nghiệp vụ cập nhật dùng chung cho API sửa và dời lịch."""
from datetime import timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import mark_changed
from app.db.models import User, utcnow
from app.db.calendar import CalendarEventFollower
from app.modules.calendar.schemas import EventUpdate

from .ownership import find_owned_event


async def update_event_service(event_id: str, payload: EventUpdate, user: User, db: AsyncSession, *, record_history=True, allow_elapsed=False):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    event, has_note = await find_owned_event(event_id, user, db)
    from app.modules.notifications.scheduling import signature, sync_event_jobs
    from app.modules.notifications.reminder_fields import reminder_update
    note = None
    if has_note:
        from app.db.models import Note
        note = await db.get(Note, event.scheduled_note_id)
    active = not note.is_archived if note else True
    reminder_before = signature(event, 'event', active)
    from app.modules.rescheduling.service import event_snapshot
    before = event_snapshot(event)
    modified = event.updated_at
    if modified.tzinfo is None:
        modified = modified.replace(tzinfo=timezone.utc)
    if modified != payload.expected_updated_at:
        raise HTTPException(409, "Sự kiện đã thay đổi. Nội dung đang sửa được giữ; hãy mở lại bản mới trước khi lưu.")
    data = payload.model_dump(exclude={"expected_updated_at", "reminder_minutes", "reminder_at", "follower_ids"} | ({key for key in ("is_private", "recurrence") if key not in payload.model_fields_set}))
    data.update(reminder_update(payload))
    data = {key: value for key, value in data.items() if getattr(event, key) != value}
    from .access import sync_followers
    added, removed = await sync_followers(db,event,user,payload.follower_ids) if payload.follower_ids is not None else (set(), set())
    if not data and not added and not removed:
        return event
    if "is_private" in payload.model_fields_set and payload.is_private != event.is_private:
        from app.modules.access.privacy import require_privacy_change
        await require_privacy_change(db, user.id, payload.is_private, event.is_private)
        if has_note:
            from app.db.models import Note
            from sqlalchemy import update
            await db.execute(update(Note).where(Note.id == event.scheduled_note_id, Note.user_id == user.id)
                .values(is_private=payload.is_private, version=Note.version + 1, updated_at=utcnow()))
        mark_changed(db, user.id, "calendar-privacy")
    if event.recurrence_until and 'starts_at' in data:
        from app.core.datetime_utils import database_utc
        event.recurrence_until = database_utc(event.recurrence_until) + (data['starts_at'] - database_utc(event.starts_at))
    for key, value in data.items():
        setattr(event, key, value)
    event.updated_at = utcnow()
    await sync_event_jobs(db, event, before=reminder_before, active=active, allow_elapsed=allow_elapsed)
    await db.flush()
    await db.refresh(event)
    mark_changed(db, user.id, "calendar")
    mark_changed(db, user.id, "notifications")
    from app.modules.collaboration_notifications import notify
    for recipient in added:
        notify(db,recipient,'event_followed',f'Bạn được thêm vào sự kiện: {event.title}',f'{user.full_name} đã thêm bạn vào danh sách theo dõi.','event',event.id,event_id=event.id,revision=str(event.updated_at))
        mark_changed(db,recipient,'calendar'); mark_changed(db,recipient,'notifications')
    for recipient in removed: mark_changed(db,recipient,'calendar')
    current_followers = (await db.scalars(select(CalendarEventFollower.user_id).where(CalendarEventFollower.event_id==event.id))).all()
    for recipient in current_followers:
        if data:
            notify(db,recipient,'event_changed',f'Sự kiện đã cập nhật: {event.title}',f'{user.full_name} đã cập nhật sự kiện bạn đang theo dõi.','event',event.id,event_id=event.id,revision=str(event.updated_at))
            mark_changed(db,recipient,'notifications')
        mark_changed(db,recipient,'calendar')
    if has_note: mark_changed(db, user.id, "notes")
    if record_history:
        from app.modules.rescheduling.service import record_change
        if has_note:
            from app.db.models import Note
            note = await db.get(Note, event.scheduled_note_id)
            await record_change(db, user, 'note', note, before)
        else:
            await record_change(db, user, 'event', event, before)
    return event


async def event_details(db, event):
    """Canonical detail metadata, including the owning recurrence family."""
    from .deletion import recurrence_parent
    from app.db.calendar_exceptions import CalendarException
    from app.modules.calendar.schemas import EventResponse
    parent_id = await recurrence_parent(db, event.id, event.user_id)
    has_edits = await db.scalar(select(CalendarException.replacement_id).where(
        CalendarException.event_id == event.id, CalendarException.replacement_id.is_not(None)).limit(1))
    value = EventResponse.model_validate(event)
    from .scopes import series_rule
    return value.model_copy(update={'series_recurrence':await series_rule(db,event.id,event.recurrence), 'deletion_includes_series': event.recurrence != 'NONE' or bool(parent_id or has_edits)})

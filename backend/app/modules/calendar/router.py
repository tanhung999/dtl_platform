from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.calendar import CalendarEvent, CalendarEventFollower
from app.db.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.calendar.schemas import EventResponse, EventCreate, EventUpdate
from app.modules.creation import create_once

from .ownership import find_owned_event
from .recurrence import occurrence_page, overlaps, attach_exclusions
from .access import visible_events, visible_event, event_metadata, sync_followers

router = APIRouter(prefix="/api/calendar/events", tags=["Personal Calendar"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]


@router.get("", response_model=list[EventResponse])
async def list_events(
    user: CurrentUser,
    db: Database,
    start: Annotated[datetime, Query()],
    end: Annotated[datetime, Query()],
):
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(status_code=422, detail="Khoảng xem lịch phải kèm múi giờ.")
    start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    if end <= start or end - start > timedelta(days=93):
        raise HTTPException(status_code=422, detail="Khoảng xem lịch phải lớn hơn 0 và tối đa 93 ngày.")
    # Half-open intervals include events spanning into the requested range.
    result = await db.execute(
        select(CalendarEvent)
        .where(
            visible_events(user.id),
            *overlaps(CalendarEvent, start, end),
            CalendarEvent.recurrence == "NONE",
        )
        .order_by(CalendarEvent.starts_at, CalendarEvent.id).limit(500)
    )
    recurring = (await db.scalars(select(CalendarEvent).where(visible_events(user.id),
        CalendarEvent.recurrence != 'NONE', *overlaps(CalendarEvent, start, end)))).all()
    events = [*result.scalars().all(), *recurring]
    rows = []
    for event in events:
        rows.append(EventResponse.model_validate(event).model_dump() | await event_metadata(db,event,user))
    return occurrence_page(await attach_exclusions(db, rows, start, end), start, end, 500)


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(payload: EventCreate, user: CurrentUser, db: Database):
    data = payload.model_dump(exclude={"client_request_id", "follower_ids"})
    async def create():
        await db.execute(select(User.id).where(User.id == user.id).with_for_update())
        from app.modules.access.privacy import require_privacy_change
        await require_privacy_change(db, user.id, payload.is_private)
        event = CalendarEvent(user_id=user.id, **data)
        db.add(event)
        await db.flush()
        await db.refresh(event)
        added, _ = await sync_followers(db, event, user, payload.follower_ids)
        from app.modules.collaboration_notifications import notify
        for recipient in added:
            notify(db, recipient, 'event_followed', f'Bạn được thêm vào sự kiện: {event.title}',
                f'{user.full_name} đã thêm bạn vào danh sách theo dõi.', 'event', event.id, event_id=event.id)
            mark_changed(db, recipient, 'calendar'); mark_changed(db, recipient, 'notifications')
        from app.modules.notifications.scheduling import sync_event_jobs
        await sync_event_jobs(db, event)
        mark_changed(db, user.id, "calendar")
        return event
    fingerprint = {**data, 'follower_ids': sorted(set(payload.follower_ids))}
    event = await create_once(db, user, "event", payload.client_request_id, {k: v for k, v in fingerprint.items() if k != "is_private" or v}, CalendarEvent, create)
    return EventResponse.model_validate(event).model_copy(update=await event_metadata(db,event,user))




@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, user: CurrentUser, db: Database):
    event = await visible_event(db, event_id, user)
    from .service import event_details
    value = await event_details(db, event)
    return value.model_copy(update=await event_metadata(db,event,user))


@router.put("/{event_id}", response_model=EventResponse)
async def update_event(event_id: str, payload: EventUpdate, user: CurrentUser, db: Database):
    from .service import update_event_service
    event = await update_event_service(event_id, payload, user, db)
    return EventResponse.model_validate(event).model_copy(update=await event_metadata(db,event,user))


@router.post("/{event_id}/unfollow", response_model=EventResponse)
async def unfollow_event(event_id: str, user: CurrentUser, db: Database):
    event = await visible_event(db,event_id,user,lock=True)
    if event.user_id == user.id: raise HTTPException(422,"Chủ sự kiện không thể bỏ theo dõi sự kiện của mình.")
    from sqlalchemy import delete
    await db.execute(delete(CalendarEventFollower).where(CalendarEventFollower.event_id==event.id,CalendarEventFollower.user_id==user.id))
    mark_changed(db,user.id,'calendar')
    mark_changed(db,user.id,'notifications')
    return EventResponse.model_validate(event).model_copy(update=await event_metadata(db,event,user))


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: str, user: CurrentUser, db: Database, expected_updated_at: datetime, scope: Literal["ALL", "FOLLOWING", "THIS"] = "ALL", occurrence_at: datetime | None = None):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    # Capture the association while the event exists, before deleting its mapping.
    event, has_note = await find_owned_event(event_id, user, db)
    follower_ids = list((await db.scalars(select(CalendarEventFollower.user_id).where(CalendarEventFollower.event_id == event.id))).all())
    modified = event.updated_at if event.updated_at.tzinfo else event.updated_at.replace(tzinfo=timezone.utc)
    if expected_updated_at.tzinfo is None:
        raise HTTPException(422, "Phiên bản sự kiện phải kèm múi giờ.")
    if modified != expected_updated_at.astimezone(timezone.utc):
        raise HTTPException(409, {"message": "Sự kiện vừa được cập nhật. Hãy xem bản mới và xác nhận xóa lại.", "current": EventResponse.model_validate(event).model_dump(mode="json")})
    if scope != 'ALL':
        from .scopes import scoped_delete
        await scoped_delete(db, event, scope, occurrence_at)
        from app.modules.collaboration_notifications import notify
        for recipient in follower_ids:
            notify(db,recipient,'event_cancelled',f'Sự kiện đã hủy: {event.title}',f'{user.full_name} đã hủy lịch bạn đang theo dõi.','event',event.id,event_id=event.id,revision=str(event.updated_at))
            mark_changed(db, recipient, 'calendar'); mark_changed(db,recipient,'notifications')
        return
    from .deletion import delete_series
    has_note = await delete_series(db, event.id, user.id) or has_note
    mark_changed(db, user.id, "notifications")
    mark_changed(db, user.id, "calendar")
    from app.modules.collaboration_notifications import notify
    for recipient in follower_ids:
        notify(db,recipient,'event_cancelled',f'Sự kiện đã hủy: {event.title}',f'{user.full_name} đã hủy lịch bạn đang theo dõi.','event',event.id,revision=str(event.updated_at))
        mark_changed(db, recipient, 'calendar'); mark_changed(db,recipient,'notifications')
    if has_note: mark_changed(db, user.id, "notes")

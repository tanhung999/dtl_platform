from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.calendar import CalendarEvent
from app.db.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.calendar.schemas import EventResponse, EventCreate, EventUpdate
from app.modules.creation import create_once

from .ownership import find_owned_event
from .recurrence import occurrence_page, overlaps, attach_exclusions

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
            CalendarEvent.user_id == user.id,
            *overlaps(CalendarEvent, start, end),
            CalendarEvent.recurrence == "NONE",
        )
        .order_by(CalendarEvent.starts_at, CalendarEvent.id).limit(500)
    )
    recurring = (await db.scalars(select(CalendarEvent).where(CalendarEvent.user_id == user.id,
        CalendarEvent.recurrence != 'NONE', *overlaps(CalendarEvent, start, end)))).all()
    rows = [EventResponse.model_validate(event).model_dump() for event in [*result.scalars().all(), *recurring]]
    return occurrence_page(await attach_exclusions(db, rows, start, end), start, end, 500)


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(payload: EventCreate, user: CurrentUser, db: Database):
    data = payload.model_dump(exclude={"client_request_id"})
    async def create():
        await db.execute(select(User.id).where(User.id == user.id).with_for_update())
        from app.modules.access.privacy import require_privacy_change
        await require_privacy_change(db, user.id, payload.is_private)
        event = CalendarEvent(user_id=user.id, **data)
        db.add(event)
        await db.flush()
        await db.refresh(event)
        from app.modules.notifications.scheduling import sync_event_jobs
        await sync_event_jobs(db, event)
        mark_changed(db, user.id, "calendar")
        return event
    return await create_once(db, user, "event", payload.client_request_id, {k: v for k, v in data.items() if k != "is_private" or v}, CalendarEvent, create)




@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, user: CurrentUser, db: Database):
    event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id))
    if event is None:
        raise HTTPException(404, "Không tìm thấy sự kiện.")
    from .deletion import recurrence_parent
    from app.db.calendar_exceptions import CalendarException
    parent_id = await recurrence_parent(db, event.id, user.id)
    has_edits = await db.scalar(select(CalendarException.replacement_id).where(
        CalendarException.event_id == event.id, CalendarException.replacement_id.is_not(None)).limit(1))
    value = EventResponse.model_validate(event)
    from .scopes import series_rule
    return value.model_copy(update={'series_recurrence':await series_rule(db,event.id,event.recurrence), 'deletion_includes_series': event.recurrence != 'NONE' or bool(parent_id or has_edits)})


@router.put("/{event_id}", response_model=EventResponse)
async def update_event(event_id: str, payload: EventUpdate, user: CurrentUser, db: Database):
    from .service import update_event_service
    return await update_event_service(event_id, payload, user, db)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: str, user: CurrentUser, db: Database, expected_updated_at: datetime, scope: Literal["ALL", "FOLLOWING", "THIS"] = "ALL", occurrence_at: datetime | None = None):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    # Capture the association while the event exists, before deleting its mapping.
    event, has_note = await find_owned_event(event_id, user, db)
    modified = event.updated_at if event.updated_at.tzinfo else event.updated_at.replace(tzinfo=timezone.utc)
    if expected_updated_at.tzinfo is None:
        raise HTTPException(422, "Phiên bản sự kiện phải kèm múi giờ.")
    if modified != expected_updated_at.astimezone(timezone.utc):
        raise HTTPException(409, {"message": "Sự kiện vừa được cập nhật. Hãy xem bản mới và xác nhận xóa lại.", "current": EventResponse.model_validate(event).model_dump(mode="json")})
    if scope != 'ALL':
        from .scopes import scoped_delete
        await scoped_delete(db, event, scope, occurrence_at)
        return
    from .deletion import delete_series
    has_note = await delete_series(db, event.id, user.id) or has_note
    mark_changed(db, user.id, "notifications")
    mark_changed(db, user.id, "calendar")
    if has_note: mark_changed(db, user.id, "notes")

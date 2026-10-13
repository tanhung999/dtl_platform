from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.calendar import CalendarEvent
from app.db.models import User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.calendar.schemas import EventResponse, EventWrite
from app.modules.calendar.interaction_schemas import EventInteraction
from pydantic import ValidationError

router = APIRouter(prefix="/api/calendar/events", tags=["Personal Calendar"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db)]


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
            CalendarEvent.starts_at < end,
            CalendarEvent.ends_at > start,
        )
        .order_by(CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.id)
    )
    return result.scalars().all()


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(payload: EventWrite, user: CurrentUser, db: Database):
    event = CalendarEvent(user_id=user.id, **payload.model_dump())
    db.add(event)
    await db.flush()
    mark_changed(db, user.id, "calendar")
    return event


async def find_owned_event(event_id: str, user: User, db: AsyncSession) -> CalendarEvent:
    result = await db.execute(
        select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id).with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy sự kiện.")
    return event


@router.put("/{event_id}", response_model=EventResponse)
async def update_event(event_id: str, payload: EventWrite, user: CurrentUser, db: Database):
    event = await find_owned_event(event_id, user, db)
    for key, value in payload.model_dump().items():
        setattr(event, key, value)
    event.updated_at = utcnow()
    await db.flush()
    mark_changed(db, user.id, "calendar")
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: str, user: CurrentUser, db: Database):
    event = await find_owned_event(event_id, user, db)
    await db.delete(event)
    mark_changed(db, user.id, "calendar")


@router.patch("/{event_id}/schedule", response_model=EventResponse)
async def change_schedule(event_id: str, payload: EventInteraction, user: CurrentUser, db: Database):
    event = await find_owned_event(event_id, user, db)
    modified = event.updated_at
    if modified.tzinfo is None:
        modified = modified.replace(tzinfo=timezone.utc)
    if modified != payload.expected_updated_at:
        raise HTTPException(409, "Sự kiện đã thay đổi ở nơi khác. Vui lòng thử lại.")
    try:
        payload.validate_event(event)
    except ValidationError:
        raise HTTPException(422, "Thời gian sự kiện không hợp lệ; kết thúc phải sau bắt đầu và sự kiện cả ngày dùng biên 00:00.")
    event.starts_at, event.ends_at, event.is_all_day = payload.starts_at, payload.ends_at, payload.is_all_day
    event.updated_at = utcnow()
    await db.flush()
    mark_changed(db, user.id, "calendar")
    return event

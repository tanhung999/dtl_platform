from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.models import User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.calendar.schemas import EventResponse, EventCreate, EventUpdate
from app.modules.creation import create_once
from app.modules.calendar.interaction_schemas import EventInteraction
from pydantic import ValidationError

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
            CalendarEvent.starts_at < end,
            CalendarEvent.ends_at > start,
        )
        .order_by(CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.id).limit(500)
    )
    return result.scalars().all()


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(payload: EventCreate, user: CurrentUser, db: Database):
    data = payload.model_dump(exclude={"client_request_id"})
    async def create():
        await db.execute(select(User.id).where(User.id == user.id).with_for_update())
        event = CalendarEvent(user_id=user.id, **data)
        db.add(event)
        await db.flush()
        await db.refresh(event)
        mark_changed(db, user.id, "calendar")
        return event
    return await create_once(db, user, "event", payload.client_request_id, {k: v for k, v in data.items() if k != "is_private" or v}, CalendarEvent, create)


async def find_owned_event(event_id: str, user: User, db: AsyncSession) -> tuple[CalendarEvent, bool]:
    result = await db.execute(
        select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id).with_for_update()
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Không tìm thấy sự kiện.")
    # scheduled_note_id is already a scalar subquery backed by the unique event_id
    # index. Capture it now; avoid a duplicate EXISTS lookup or a post-delete check.
    return event, event.scheduled_note_id is not None


@router.get("/{event_id}", response_model=EventResponse)
async def get_event(event_id: str, user: CurrentUser, db: Database):
    event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id))
    if event is None:
        raise HTTPException(404, "Không tìm thấy sự kiện.")
    return event


@router.put("/{event_id}", response_model=EventResponse)
async def update_event(event_id: str, payload: EventUpdate, user: CurrentUser, db: Database):
    event, has_note = await find_owned_event(event_id, user, db)
    modified = event.updated_at
    if modified.tzinfo is None:
        modified = modified.replace(tzinfo=timezone.utc)
    if modified != payload.expected_updated_at:
        raise HTTPException(409, "Sự kiện đã thay đổi. Nội dung đang sửa được giữ; hãy mở lại bản mới trước khi lưu.")
    if "is_private" in payload.model_fields_set and payload.is_private != event.is_private:
        mark_changed(db, user.id, "calendar-privacy")
    for key, value in payload.model_dump(exclude={"expected_updated_at"} | ({"is_private"} if "is_private" not in payload.model_fields_set else set())).items():
        setattr(event, key, value)
    event.updated_at = utcnow()
    await db.flush()
    await db.refresh(event)
    mark_changed(db, user.id, "calendar")
    if has_note: mark_changed(db, user.id, "notes")
    return event


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(event_id: str, user: CurrentUser, db: Database, expected_updated_at: datetime):
    # Capture the association while the event exists, before deleting its mapping.
    event, has_note = await find_owned_event(event_id, user, db)
    modified = event.updated_at if event.updated_at.tzinfo else event.updated_at.replace(tzinfo=timezone.utc)
    if expected_updated_at.tzinfo is None:
        raise HTTPException(422, "Phiên bản sự kiện phải kèm múi giờ.")
    if modified != expected_updated_at.astimezone(timezone.utc):
        raise HTTPException(409, {"message": "Sự kiện vừa được cập nhật. Hãy xem bản mới và xác nhận xóa lại.", "current": EventResponse.model_validate(event).model_dump(mode="json")})
    await db.execute(delete(NoteCalendarSchedule).where(NoteCalendarSchedule.event_id == event.id))
    await db.delete(event)
    mark_changed(db, user.id, "calendar")
    if has_note: mark_changed(db, user.id, "notes")


@router.patch("/{event_id}/schedule", response_model=EventResponse)
async def change_schedule(event_id: str, payload: EventInteraction, user: CurrentUser, db: Database):
    event, has_note = await find_owned_event(event_id, user, db)
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
    await db.refresh(event)
    mark_changed(db, user.id, "calendar")
    if has_note: mark_changed(db, user.id, "notes")
    return event

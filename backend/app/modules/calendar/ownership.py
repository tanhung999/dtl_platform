"""Tra cứu tài nguyên thuộc chủ sở hữu."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.models import User
from app.db.calendar import CalendarEvent

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

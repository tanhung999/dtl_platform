"""Preview the next reminder for an existing recurring calendar series."""
from datetime import timedelta
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.datetime_utils import database_utc
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException
from app.db.models import Note, User, utcnow
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix='/api/calendar/events', tags=['Calendar reminders'])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope='function')]


@router.get('/{event_id}/next-reminder')
async def next_reminder(event_id: str, user: UserArg, db: DbArg, minutes: int = Query(ge=0, le=10080)):
    event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id))
    if not event: raise HTTPException(404, 'Không tìm thấy sự kiện.')
    from app.modules.notifications.scheduling import recurring_period
    period, now = recurring_period(event), utcnow()
    if not period or event.is_all_day: return {'at': None}
    note = await db.get(Note, event.scheduled_note_id) if event.scheduled_note_id else None
    if note and note.is_archived: return {'at': None}
    offset = timedelta(minutes=minutes)
    stamp = database_utc(event.starts_at) - offset
    if stamp <= now: stamp += ((now - stamp) // period + 1) * period
    skipped = set((await db.scalars(select(CalendarException.occurrence_at).where(
        CalendarException.event_id == event.id, CalendarException.occurrence_at >= stamp + offset))).all())
    while stamp + offset in skipped: stamp += period
    if event.recurrence_until and stamp + offset >= database_utc(event.recurrence_until): return {'at': None}
    return {'at': stamp}

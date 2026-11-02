"""Preview the next reminder for an existing recurring calendar series."""
from datetime import datetime
from types import SimpleNamespace
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException
from app.db.models import Note, User, utcnow
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix='/api/calendar/events', tags=['Calendar reminders'])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope='function')]


@router.get('/{event_id}/next-reminder')
async def next_reminder(event_id: str, user: UserArg, db: DbArg, minutes: int | None = Query(default=None, ge=0, le=10080), at: datetime | None = Query(default=None)):
    event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == event_id, CalendarEvent.user_id == user.id))
    if not event: raise HTTPException(404, 'Không tìm thấy sự kiện.')
    from app.modules.notifications.scheduling import recurring_period, reminder_time, reminder_occurrence, valid_recurring_stamp
    period, now = recurring_period(event), utcnow()
    if not period or event.is_all_day and minutes is not None: return {'at': None}
    if (minutes is None) == (at is None): raise HTTPException(422, 'Chọn một cách thông báo.')
    if at is not None and (at.tzinfo is None or at.utcoffset() is None): raise HTTPException(422, 'Giờ thông báo phải kèm múi giờ.')
    note = await db.get(Note, event.scheduled_note_id) if event.scheduled_note_id else None
    if note and note.is_archived: return {'at': None}
    preview = SimpleNamespace(starts_at=event.starts_at, ends_at=event.ends_at, is_all_day=event.is_all_day,
        recurrence=event.recurrence, recurrence_until=event.recurrence_until, reminder_repeat=True, reminder_minutes=minutes, reminder_at=at)
    stamp = reminder_time(preview, 'event', now)
    if stamp is None: return {'at': None}
    skipped = set((await db.scalars(select(CalendarException.occurrence_at).where(
        CalendarException.event_id == event.id, CalendarException.occurrence_at >= reminder_occurrence(preview, stamp)))).all())
    while reminder_occurrence(preview, stamp) in skipped: stamp += period
    if not valid_recurring_stamp(preview, stamp): return {'at': None}
    return {'at': stamp}

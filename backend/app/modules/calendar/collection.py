"""Bounded grids and independent day counts; capped results never imply empty days."""
from datetime import date, datetime, time, timedelta, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, case, func, literal, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.datetime_utils import utc_mapping
from app.db.calendar import CalendarEvent as Event
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.db.models import Task, User, utcnow
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.deadlines import VN
from app.modules.tasks.queries import overdue_condition

from .recurrence import occurrence_count, occurrence_page, overlaps, attach_exclusions
from .access import visible_events
from app.db.calendar import CalendarEventFollower
from app.modules.tasks.access import visible_tasks, serialize_tasks

router = APIRouter(prefix="/api/calendar", tags=["Personal Calendar"])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope="function")]


@router.get("/events/collection")
async def events_page(user: UserArg, db: DbArg, start: datetime, end: datetime, limit: int = Query(500, ge=1, le=500), include_events: bool = True, include_notes: bool = True, offset: int = Query(0, ge=0)):
    if start.tzinfo is None or end.tzinfo is None or end <= start or end - start > timedelta(days=93):
        raise HTTPException(422, "Khoảng xem phải kèm múi giờ và tối đa 93 ngày.")
    start, end = start.astimezone(timezone.utc), end.astimezone(timezone.utc)
    owned = (visible_events(user.id), *overlaps(Event, start, end))
    is_note = Schedule.note_id.is_not(None)
    event_total, note_total = (await db.execute(select(func.count().filter(~is_note), func.count().filter(is_note))
        .select_from(Event).outerjoin(Schedule, Schedule.event_id == Event.id).where(*owned))).one()
    fields = [Event.id, Event.user_id, Event.title, Event.location, Event.starts_at, Event.ends_at,
              Event.recurrence, Event.recurrence_until, Event.is_all_day, Event.is_private, Event.color, Event.created_at, Event.updated_at, Schedule.note_id.label("scheduled_note_id")]
    recurring = (await db.execute(select(*fields).outerjoin(Schedule, Schedule.event_id == Event.id)
        .where(*owned, Event.recurrence != 'NONE'))).mappings().all()
    recurring = await attach_exclusions(db, recurring, start, end)
    series = []
    for row in recurring:
        extra = occurrence_count(row, start, end) - 1
        if row['scheduled_note_id']: note_total += extra
        else: event_total += extra
        if include_notes if row['scheduled_note_id'] else include_events:
            series.append({**utc_mapping(row), 'description': ''})
    total = (event_total if include_events else 0) + (note_total if include_notes else 0)
    visible = True if include_events and include_notes else is_note if include_notes else ~is_note if include_events else False
    rows = (await db.execute(select(*fields).outerjoin(Schedule, Schedule.event_id == Event.id)
        .where(*owned, visible, Event.recurrence == 'NONE').order_by(Event.starts_at, Event.id).limit(offset + limit))).mappings().all()
    series.extend({**utc_mapping(row), 'description': ''} for row in rows)
    items = occurrence_page(series, start, end, limit, offset)
    event_ids = {item['id'] for item in items}
    followed = set((await db.scalars(select(CalendarEventFollower.event_id).where(
        CalendarEventFollower.user_id == user.id, CalendarEventFollower.event_id.in_(event_ids)))).all()) if event_ids else set()
    for item in items:
        item.update(is_following=item['id'] in followed, can_edit=item['user_id']==user.id, can_delete=item['user_id']==user.id,
            followers=[], owner=None)
    return {"items": items, "total": total, "event_total": event_total, "note_total": note_total,
            "offset": offset, "limit": limit, "truncated": offset + len(items) < total}



@router.get("/days")
async def day_counts(user: UserArg, db: DbArg, start: date, end: date):
    size = (end - start).days
    if size <= 0 or size > 93:
        raise HTTPException(422, "Khoảng xem phải lớn hơn 0 và tối đa 93 ngày.")
    dates = [start + timedelta(days=i) for i in range(size)]
    days = union_all(*[select(literal(day.isoformat()).label("day"),
        literal(datetime.combine(day, time.min, VN).astimezone(timezone.utc)).label("begins"),
        literal(datetime.combine(day + timedelta(days=1), time.min, VN).astimezone(timezone.utc)).label("ends")) for day in dates]).subquery()
    rows = (await db.execute(select(days.c.day, func.count(Event.id).filter(Schedule.note_id.is_(None)), func.count(Event.id).filter(Schedule.note_id.is_not(None))).select_from(days).outerjoin(Event,
        and_(visible_events(user.id), Event.recurrence == 'NONE', Event.starts_at < days.c.ends, Event.ends_at > days.c.begins)).outerjoin(Schedule, Schedule.event_id == Event.id).group_by(days.c.day))).all()
    result = {day: {"events": events, "notes": notes, "tasks": 0, "attention": False} for day, events, notes in rows}
    last = datetime.combine(end, time.min, VN).astimezone(timezone.utc)
    recurring = (await db.execute(select(Event.id, Event.starts_at, Event.ends_at, Event.recurrence, Event.recurrence_until, Schedule.note_id)
        .outerjoin(Schedule, Schedule.event_id == Event.id).where(visible_events(user.id), Event.recurrence != 'NONE', Event.starts_at < last))).mappings().all()
    first = datetime.combine(start, time.min, VN).astimezone(timezone.utc)
    recurring = await attach_exclusions(db, recurring, first, last)
    windows = [(day.isoformat(), datetime.combine(day, time.min, VN).astimezone(timezone.utc),
                datetime.combine(day + timedelta(days=1), time.min, VN).astimezone(timezone.utc)) for day in dates]
    for row in recurring:
        category = 'notes' if row['note_id'] else 'events'
        for day, begins, finishes in windows:
            result[day][category] += occurrence_count(row, begins, finishes)
    attention = and_(Task.is_completed.is_(False), (Task.priority == "URGENT") | overdue_condition(utcnow()))
    tasks = (await db.execute(select(Task.due_date, func.count(), func.max(case((attention, 1), else_=0)))
        .where(visible_tasks(user.id), Task.due_date >= start, Task.due_date < end).group_by(Task.due_date))).all()
    for day, count, urgent in tasks:
        result[str(day)].update(tasks=count, attention=bool(urgent))
    return result

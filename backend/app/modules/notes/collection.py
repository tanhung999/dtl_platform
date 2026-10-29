"""Paged note previews, with recent pin actions first in the pinned collection."""
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, select, and_, true, false
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.text_search import fold_text
from app.db.models import Note, User, utcnow
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/notes/collection", tags=["Notes"])

def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

async def schedule_summaries(db, user_id, ids):
    if not ids:
        return {}
    rows = await db.execute(select(Schedule.note_id, CalendarEvent.id, CalendarEvent.title, CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.is_all_day, CalendarEvent.recurrence, CalendarEvent.recurrence_until)
        .join(CalendarEvent, Schedule.event_id == CalendarEvent.id).where(Schedule.note_id.in_(ids), CalendarEvent.user_id == user_id))
    from app.modules.calendar.recurrence import iter_occurrences
    result, now = {}, utcnow()
    source_rows = [dict(row._mapping) for row in rows]
    from app.modules.calendar.recurrence import attach_exclusions
    source_rows = await attach_exclusions(db, source_rows, now, now + timedelta(days=8))
    for row in source_rows:
        summary = {key: utc(row[key]) if key in ('starts_at', 'ends_at') else row[key]
                   for key in ('id', 'title', 'starts_at', 'ends_at', 'is_all_day', 'recurrence', 'recurrence_until')}
        if row['recurrence'] != 'NONE':
            summary['_excluded'] = row.get('_excluded', ())
            summary = next(iter_occurrences(summary, now, now + timedelta(days=8)), summary)
        summary.pop('_excluded', None)
        result[row['note_id']] = summary
    return result


@router.get("/page")
async def note_page(
    user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    q: str = Query(default="", max_length=200), filter: Literal["all", "scheduled", "pinned"] = "all",
    archived: bool = False, widget: bool = False,
    offset: int = Query(default=0, ge=0), limit: int = Query(default=24, ge=1, le=50),
):
    owned = (Note.user_id == user.id, Note.is_archived.is_(archived))
    scheduled = exists(select(Schedule.note_id).where(Schedule.note_id == Note.id))
    keyword = fold_text(q)
    matches = false() if keyword and len(keyword) < 2 else Note.search_text.contains(keyword, autoescape=True) if keyword else true()
    if filter == "scheduled":
        matches = and_(matches, scheduled)
    elif filter == "pinned":
        matches = and_(matches, Note.is_pinned.is_(True))
    counts = (await db.execute(select(func.count(), func.count().filter(scheduled),
        func.count().filter(Note.is_pinned.is_(True)), func.count().filter(matches)).where(*owned))).one()
    total = counts[3]
    fields = [Note.id, Note.title, func.substr(Note.content, 1, 240).label("preview"), Note.color,
              Note.is_pinned, Note.pinned_at, Note.is_archived, Note.is_private, Note.version, Note.created_at, Note.updated_at]
    # Limit narrow ID rows first; do not compute previews for every row being sorted.
    base = select(Note.id, Note.is_pinned, Note.pinned_at, Note.created_at).where(*owned, matches)
    pin_order = filter == 'pinned'
    order = (func.coalesce(Note.pinned_at, Note.created_at).desc().nullslast(), Note.created_at.desc().nullslast(), Note.id) if pin_order else (Note.is_pinned.desc(), Note.created_at.desc().nullslast(), Note.id)
    if widget and pin_order:
        picked = base.order_by(*order).limit(4).subquery()
        offset = 0
    elif widget:
        pinned = base.where(Note.is_pinned.is_(True)).order_by(*order).limit(6).subquery()
        unpinned = base.where(Note.is_pinned.is_(False)).order_by(*order).limit(6).subquery()
        combined = select(*pinned.c).union_all(select(*unpinned.c)).subquery()
        picked = combined
        offset = 0
    else:
        offset = min(offset, ((total - 1) // limit) * limit) if total else 0
        picked = base.order_by(*order).offset(offset).limit(limit).subquery()
    selected_order = (func.coalesce(picked.c.pinned_at, picked.c.created_at).desc().nullslast(), picked.c.created_at.desc().nullslast(), picked.c.id) if pin_order else (picked.c.is_pinned.desc(), picked.c.created_at.desc().nullslast(), picked.c.id)
    query = select(*fields).join(picked, Note.id == picked.c.id).order_by(*selected_order)
    previews = (await db.execute(query)).mappings().all() if total else []
    selected = [row['id'] for row in previews]
    summaries = await schedule_summaries(db, user.id, selected)
    items = []
    for row in previews:
        item = dict(row)
        for key in ("created_at", "updated_at"):
            item[key] = utc(item[key])
        if item['pinned_at'] is not None:
            item['pinned_at'] = utc(item['pinned_at'])
        item["scheduled_event"] = summaries.get(item['id'])
        items.append(item)
    now = datetime.now(timezone.utc)
    next_refresh = min((item["scheduled_event"]["ends_at"] for item in items if item["scheduled_event"] and item["scheduled_event"]["ends_at"] > now), default=None)
    return {"server_now": now, "next_refresh_at": next_refresh, "items": items, "total": total, "total_active": counts[0], "offset": offset, "limit": limit,
            "has_more": len(selected) < total if widget else offset + limit < total,
            "hidden": max(0, total - len(selected)) if widget else 0,
            "has_scheduled": bool(counts[1]), "pinned_total": counts[2]}

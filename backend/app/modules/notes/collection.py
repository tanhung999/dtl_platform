"""Paged note previews. Only lightweight ordering IDs span the full collection."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.text_search import fold_text
from app.db.models import Note, User
from app.db.workspace_layout import WorkspaceLayout
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/notes/collection", tags=["Notes"])

def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

async def schedule_summaries(db, user_id, ids):
    if not ids:
        return {}
    rows = await db.execute(select(Schedule.note_id, CalendarEvent.id, CalendarEvent.title, CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.is_all_day)
        .join(CalendarEvent, Schedule.event_id == CalendarEvent.id).where(Schedule.note_id.in_(ids), CalendarEvent.user_id == user_id))
    return {row.note_id: {key: utc(row._mapping[key]) if key in ("starts_at", "ends_at") else row._mapping[key]
            for key in ("id", "title", "starts_at", "ends_at", "is_all_day")} for row in rows}

@router.get("/page")
async def note_page(
    user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    q: str = Query(default="", max_length=200), filter: Literal["all", "scheduled", "pinned"] = "all",
    archived: bool = False, widget: bool = False,
    offset: int = Query(default=0, ge=0), limit: int = Query(default=24, ge=1, le=50),
):
    owned = (Note.user_id == user.id, Note.is_archived.is_(archived))
    scheduled = exists(select(Schedule.note_id).where(Schedule.note_id == Note.id))
    stmt = select(Note.id).where(*owned)
    if fold_text(q) and len(fold_text(q)) < 2:
        stmt = stmt.where(False)
    elif fold_text(q):
        stmt = stmt.where(Note.search_text.contains(fold_text(q), autoescape=True))
    if filter == "scheduled":
        stmt = stmt.where(scheduled)
    elif filter == "pinned":
        stmt = stmt.where(Note.is_pinned.is_(True))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery()))
    counts = (await db.execute(select(func.count(), func.count().filter(scheduled), func.count().filter(Note.is_pinned.is_(True))).where(*owned))).one()
    ordered = stmt.order_by(Note.is_pinned.desc(), Note.sort_order, Note.id)
    if widget:
        pinned = (await db.scalars(ordered.where(Note.is_pinned.is_(True)).limit(6))).all()
        unpinned = (await db.scalars(ordered.where(Note.is_pinned.is_(False)).limit(6))).all()
        selected = pinned + unpinned
        offset = 0
    else:
        offset = min(offset, ((total - 1) // limit) * limit) if total else 0
        selected = (await db.scalars(ordered.offset(offset).limit(limit))).all()
    order_version = await db.scalar(select(WorkspaceLayout.version).where(WorkspaceLayout.user_id == user.id, WorkspaceLayout.kind == "notes")) or 0
    items = []
    if selected:
        previews = (await db.execute(select(Note.id, Note.title, func.substr(Note.content, 1, 240).label("preview"), Note.color,
                     Note.is_pinned, Note.is_archived, Note.version, Note.created_at, Note.updated_at).where(Note.id.in_(selected), *owned))).mappings().all()
        by_id = {row["id"]: dict(row) for row in previews}
        summaries = await schedule_summaries(db, user.id, selected)
        for id in selected:
            item = by_id.get(id)
            if item is not None:
                for key in ("created_at", "updated_at"):
                    item[key] = utc(item[key])
                item["scheduled_event"] = summaries.get(id)
                items.append(item)
    now = datetime.now(timezone.utc)
    next_refresh = min((item["scheduled_event"]["ends_at"] for item in items if item["scheduled_event"] and item["scheduled_event"]["ends_at"] > now), default=None)
    return {"server_now": now, "next_refresh_at": next_refresh, "items": items, "total": total, "total_active": counts[0], "offset": offset, "limit": limit,
            "has_more": len(selected) < total if widget else offset + limit < total,
            "hidden": max(0, total - len(selected)) if widget else 0,
            "has_scheduled": bool(counts[1]), "pinned_total": counts[2], "order_version": order_version,
            "order_ids": [row["id"] for row in items], "pinned_ids": [row["id"] for row in items if row["is_pinned"]]}

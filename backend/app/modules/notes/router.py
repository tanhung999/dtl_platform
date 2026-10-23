from typing import Annotated, List, Literal
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from sqlalchemy import select, desc, delete, func, update, exists
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import Note, User
from app.db.note_scheduling import NoteCalendarSchedule
from app.modules.note_scheduling.service import with_schedule
from app.db.note_create_requests import NoteCreateRequest
from app.modules.notes.creation import create_note_once
from app.modules.auth.dependencies import get_current_user
from app.modules.notes.schemas import NoteCreate, NoteResponse, NoteUpdate, NoteDeleteInfo

router = APIRouter(prefix="/api/notes", tags=["Notes (Start.me Style)"])


@router.get("", response_model=List[NoteResponse])
async def list_notes(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    archived: bool = False,
    offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200),
):
    stmt = (
        select(Note)
        .where(Note.user_id == user.id, Note.is_archived.is_(archived))
        .order_by(desc(Note.is_pinned), desc(Note.created_at).nullslast(), Note.id).offset(offset).limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
async def create_note(
    payload: NoteCreate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    return await create_note_once(db, user, payload)


@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(
    note_id: str,
    payload: NoteUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    from .service import update_note_service
    return await update_note_service(note_id, payload, user, db)


@router.get("/{note_id}/delete-info", response_model=NoteDeleteInfo)
async def note_delete_info(
    note_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    row = (await db.execute(select(Note.id, Note.version, func.coalesce(Note.title, "").label("title"),
        exists(select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.note_id == Note.id)).label("has_calendar_schedule"))
        .where(Note.id == note_id, Note.user_id == user.id))).one_or_none()
    if row is None:
        raise HTTPException(404, "Không tìm thấy ghi chú.")
    return dict(row._mapping)


@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(note_id: str, user: Annotated[User, Depends(get_current_user)], db: Annotated[AsyncSession, Depends(get_db, scope="function")]):
    note = await db.scalar(select(Note).where(Note.id == note_id, Note.user_id == user.id))
    if note is None:
        raise HTTPException(404, "Không tìm thấy ghi chú.")
    return await with_schedule(db, note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: str,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    expected_version: int = Body(ge=0, embed=True),
    scope: Literal["ALL", "FOLLOWING", "THIS"] = Body(default="ALL"),
    occurrence_at: datetime | None = Body(default=None),
):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    stmt = select(Note).where(Note.id == note_id, Note.user_id == user.id)
    result = await db.execute(stmt)
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Không tìm thấy ghi chú")
    if note.version != expected_version:
        raise HTTPException(409, "Ghi chú vừa được cập nhật. Hãy xem thông tin mới và xác nhận xóa lại.")
    event_id = await db.scalar(select(NoteCalendarSchedule.event_id).where(NoteCalendarSchedule.note_id == note.id))
    if scope != 'ALL':
        from app.db.calendar import CalendarEvent
        event = await db.get(CalendarEvent, event_id) if event_id else None
        if not event: raise HTTPException(422, 'Ghi chú chưa gắn vào lịch.')
        from app.modules.calendar.scopes import scoped_delete
        await scoped_delete(db, event, scope, occurrence_at)
        return
    if event_id:
        from app.modules.calendar.deletion import delete_series
        await delete_series(db, event_id, user.id, delete_notes=True)
        mark_changed(db, user.id, 'notifications')
    await db.execute(delete(NoteCalendarSchedule).where(NoteCalendarSchedule.note_id == note.id))
    await db.execute(update(NoteCreateRequest).where(NoteCreateRequest.note_id == note.id).values(note_id=None))
    from app.db.notifications import NotificationJob, Notification
    await db.execute(delete(NotificationJob).where(NotificationJob.note_id == note.id))
    await db.execute(update(Notification).where(Notification.note_id == note.id).values(note_id=None))
    mark_changed(db, user.id, 'notifications')
    if not event_id: await db.delete(note)
    mark_changed(db, user.id, "notes")
    mark_changed(db, user.id, "calendar")
    return None

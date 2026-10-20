"""Nghiệp vụ cập nhật dùng chung cho API sửa và dời lịch."""
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.realtime import mark_changed
from app.db.models import Note, User, utcnow
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.calendar import CalendarEvent
from app.modules.note_scheduling.service import save_schedule, with_schedule
from app.modules.notes.schemas import NoteUpdate

async def update_note_service(note_id: str, payload: NoteUpdate, user: User, db: AsyncSession, *, record_history=True):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    stmt = select(Note).where(Note.id == note_id, Note.user_id == user.id)
    result = await db.execute(stmt)
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Không tìm thấy ghi chú")

    if payload.expected_version != note.version:
        raise HTTPException(409, "Ghi chú đã được cập nhật ở nơi khác. Bản nháp của bạn vẫn được giữ.")
    before = None
    was_archived = note.is_archived
    update_data = payload.model_dump(exclude_unset=True, exclude={"expected_version", "calendar_schedule"})
    if any(value is None for value in update_data.values()):
        raise HTTPException(422, "Thông tin ghi chú không được để null.")
    from app.modules.access.privacy import require_privacy_change
    private_changed = 'is_private' in update_data and update_data['is_private'] != note.is_private
    if private_changed:
        await require_privacy_change(db, user.id, update_data['is_private'], note.is_private)
    target_archived = update_data.pop("is_archived", note.is_archived)
    note.version += 1
    for key, value in update_data.items():
        setattr(note, key, value)
    note.updated_at = utcnow()
    # Khôi phục trước khi đặt lịch; chỉ lưu trạng thái lưu trữ sau khi lịch hợp lệ.
    if was_archived and not target_archived:
        note.is_archived = False
    if payload.calendar_schedule is not None:
        before = await save_schedule(db, note, payload.calendar_schedule)
    if 'title' in update_data and payload.calendar_schedule is None:
        event_id = select(NoteCalendarSchedule.event_id).where(NoteCalendarSchedule.note_id == note.id)
        await db.execute(update(CalendarEvent).where(CalendarEvent.id.in_(event_id), CalendarEvent.user_id == user.id)
            .values(title=note.title or 'Ghi chú không có tiêu đề', updated_at=utcnow()))
    note.is_archived = target_archived
    if private_changed:
        if payload.calendar_schedule is None:
            event_id = select(NoteCalendarSchedule.event_id).where(NoteCalendarSchedule.note_id == note.id)
            await db.execute(update(CalendarEvent).where(CalendarEvent.id.in_(event_id), CalendarEvent.user_id == user.id)
                .values(is_private=note.is_private, updated_at=utcnow()))
        mark_changed(db, user.id, 'calendar-privacy')
    await db.flush()
    mark_changed(db, user.id, "notes")
    mark_changed(db, user.id, "calendar")
    if record_history and before is not None:
        from app.modules.rescheduling.service import record_change
        await record_change(db, user, 'note', note, before)
    return await with_schedule(db, note)

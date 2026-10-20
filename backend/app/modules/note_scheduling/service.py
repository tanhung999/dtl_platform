"""Lưu lịch hẹn cùng transaction ghi chú; không sao chép nội dung sang sự kiện."""
from datetime import timezone
from fastapi import HTTPException
from sqlalchemy import select
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.models import utcnow

async def with_schedule(db, note):
    from app.modules.notes.schemas import NoteResponse
    value = NoteResponse.model_validate(note)
    row = (await db.execute(select(CalendarEvent.id, CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.is_all_day, CalendarEvent.updated_at)
        .join(NoteCalendarSchedule, NoteCalendarSchedule.event_id == CalendarEvent.id)
        .where(NoteCalendarSchedule.note_id == note.id, CalendarEvent.user_id == note.user_id))).one_or_none()
    if row:
        from .schemas import NoteScheduleResponse
        utc = lambda dt: dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
        value.calendar_schedule = NoteScheduleResponse(event_id=row.id, starts_at=utc(row.starts_at), ends_at=utc(row.ends_at), is_all_day=row.is_all_day, expected_updated_at=utc(row.updated_at))
    return value

async def save_schedule(db, note, payload):
    before = None
    mapping = await db.get(NoteCalendarSchedule, note.id)
    if mapping:
        event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == mapping.event_id, CalendarEvent.user_id == note.user_id).with_for_update())
        modified = event.updated_at.replace(tzinfo=timezone.utc) if event and event.updated_at.tzinfo is None else (event.updated_at if event else None)
        if not event or payload.event_id != event.id or payload.expected_updated_at != modified:
            raise HTTPException(409, "Lịch hẹn đã thay đổi. Hãy tải bản mới trước khi lưu ngày giờ.")
        from app.modules.rescheduling.service import event_snapshot
        before = event_snapshot(event)
    else:
        if payload.event_id:
            raise HTTPException(409, "Lịch hẹn đã bị xóa hoặc gỡ liên kết. Hãy tải bản mới.")
        if note.is_archived:
            raise HTTPException(422, "Khôi phục ghi chú trước khi gắn vào lịch.")
        event = CalendarEvent(user_id=note.user_id, title=note.title or "Ghi chú không có tiêu đề", description="", location="", color="#2563eb", starts_at=payload.starts_at, ends_at=payload.ends_at, is_all_day=payload.is_all_day)
        db.add(event)
        await db.flush()
        db.add(NoteCalendarSchedule(note_id=note.id, event_id=event.id))
    event.title = note.title or "Ghi chú không có tiêu đề"
    event.is_private = note.is_private
    event.starts_at, event.ends_at, event.is_all_day = payload.starts_at, payload.ends_at, payload.is_all_day
    event.updated_at = utcnow()
    await db.flush()
    return before

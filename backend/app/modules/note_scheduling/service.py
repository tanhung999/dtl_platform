"""Lưu lịch hẹn cùng transaction ghi chú; không sao chép nội dung sang sự kiện."""
from datetime import timezone
from fastapi import HTTPException
from sqlalchemy import select
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.models import utcnow
from app.core.datetime_utils import database_utc

async def with_schedule(db, note):
    from app.modules.notes.schemas import NoteResponse
    value = NoteResponse.model_validate(note)
    row = (await db.execute(select(CalendarEvent.id, CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.is_all_day, CalendarEvent.recurrence, CalendarEvent.recurrence_until, CalendarEvent.updated_at, CalendarEvent.reminder_minutes, CalendarEvent.reminder_at)
        .join(NoteCalendarSchedule, NoteCalendarSchedule.event_id == CalendarEvent.id)
        .where(NoteCalendarSchedule.note_id == note.id, CalendarEvent.user_id == note.user_id))).one_or_none()
    if row:
        from .schemas import NoteScheduleResponse
        utc = lambda dt: dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
        value.calendar_schedule = NoteScheduleResponse(event_id=row.id, starts_at=utc(row.starts_at), ends_at=utc(row.ends_at), is_all_day=row.is_all_day, recurrence=row.recurrence, expected_updated_at=utc(row.updated_at), reminder_minutes=row.reminder_minutes, reminder_at=utc(row.reminder_at) if row.reminder_at else None)
        from app.modules.calendar.scopes import series_rule
        value.calendar_series_recurrence = await series_rule(db,row.id,row.recurrence)
        from app.modules.calendar.recurrence import reference_occurrence
        value.calendar_occurrence_at = await reference_occurrence(db, row.id, row.starts_at, row.recurrence, row.recurrence_until)
    return value

async def save_schedule(db, note, payload, *, allow_elapsed=False):
    from app.modules.notifications.scheduling import signature, sync_event_jobs
    from app.modules.notifications.reminder_fields import reminder_update
    before = None
    reminder_before = None
    mapping = await db.get(NoteCalendarSchedule, note.id)
    if mapping:
        event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == mapping.event_id, CalendarEvent.user_id == note.user_id).with_for_update())
        modified = event.updated_at.replace(tzinfo=timezone.utc) if event and event.updated_at.tzinfo is None else (event.updated_at if event else None)
        if not event or payload.event_id != event.id or payload.expected_updated_at != modified:
            raise HTTPException(409, "Lịch hẹn đã thay đổi. Hãy tải bản mới trước khi lưu ngày giờ.")
        from app.modules.rescheduling.service import event_snapshot
        before = event_snapshot(event)
        reminder_before = signature(event, 'event', not note.is_archived)
    else:
        if payload.event_id:
            raise HTTPException(409, "Lịch hẹn đã bị xóa hoặc gỡ liên kết. Hãy tải bản mới.")
        if note.is_archived:
            raise HTTPException(422, "Khôi phục ghi chú trước khi gắn vào lịch.")
        event = CalendarEvent(user_id=note.user_id, title=note.title or "Ghi chú không có tiêu đề", description="", location="", color="#2563eb", starts_at=payload.starts_at, ends_at=payload.ends_at, is_all_day=payload.is_all_day)
        db.add(event)
        await db.flush()
        db.add(NoteCalendarSchedule(note_id=note.id, event_id=event.id))
        from app.modules.notes.reminders import cancel_note_reminder
        await cancel_note_reminder(db, note)
    data = dict(title=note.title or "Ghi chú không có tiêu đề", is_private=note.is_private,
                starts_at=payload.starts_at, ends_at=payload.ends_at, is_all_day=payload.is_all_day)
    if 'recurrence' in payload.model_fields_set or before is None:
        data['recurrence'] = payload.recurrence
    data.update(reminder_update(payload))
    changed = before is None or any(
        (database_utc(getattr(event, key)) if key in ('starts_at', 'ends_at') else getattr(event, key)) != value
        for key, value in data.items())
    if not changed:
        return before, False
    if event.recurrence_until and database_utc(data['starts_at']) != database_utc(event.starts_at):
        event.recurrence_until = database_utc(event.recurrence_until) + (data['starts_at'] - database_utc(event.starts_at))
    for key, value in data.items():
        setattr(event, key, value)
    event.updated_at = utcnow()
    await sync_event_jobs(db, event, before=reminder_before, active=not note.is_archived, allow_elapsed=allow_elapsed)
    await db.flush()
    return before, True

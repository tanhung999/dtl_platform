"""Keep a Note reminder in exactly one place: Note or its calendar appointment."""
from fastapi import HTTPException
from sqlalchemy import delete
from app.db.notifications import NotificationJob
from app.modules.notifications.scheduling import sync_jobs


def validate_standalone(payload):
    if payload.reminder_minutes is not None:
        raise HTTPException(422, 'Ghi chú chưa gắn lịch cần chọn ngày và giờ nhắc hạn cụ thể.')
    if payload.calendar_schedule is not None and payload.reminder_at is not None:
        raise HTTPException(422, 'Ghi chú đã gắn lịch: hãy đặt nhắc hạn trong phần lịch hẹn.')


async def sync_note_reminder(db, note, before=None, allow_elapsed=False):
    await sync_jobs(db, note, 'note', before=before, allow_elapsed=allow_elapsed)


async def cancel_note_reminder(db, note):
    if note.reminder_at is not None:
        note.reminder_at = None
        note.reminder_version += 1
    await db.execute(delete(NotificationJob).where(NotificationJob.note_id == note.id, NotificationJob.processed_at.is_(None)))

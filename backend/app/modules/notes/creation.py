"""Tạo ghi chú và lịch hẹn cùng giao dịch, chống tạo trùng theo mã yêu cầu."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy import select
from app.core.realtime import mark_changed
from app.modules.note_scheduling.service import save_schedule, with_schedule
from app.db.models import Note, User, utcnow
from app.db.note_create_requests import NoteCreateRequest

async def create_note_once(db, user, payload):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    from .reminders import validate_standalone, sync_note_reminder
    validate_standalone(payload)
    data = {"title": (payload.title or "Ghi chú mới").strip(), "content": payload.content or "", "color": payload.color or "#fef08a", "is_pinned": bool(payload.is_pinned), "is_private": payload.is_private}
    # Giữ dấu vân tay tương thích với yêu cầu tạo ghi chú độc lập trước đây.
    fingerprint_data = {"note": {k: v for k, v in data.items() if k != 'is_private' or v}, "event_id": None}
    if payload.calendar_schedule:
        fingerprint_data["calendar_schedule"] = {k: v for k, v in payload.calendar_schedule.model_dump(mode="json").items()
            if k not in ("reminder_minutes", "reminder_at") or v is not None}
    if payload.reminder_at is not None:
        fingerprint_data['reminder_at'] = payload.reminder_at.isoformat()
    fingerprint = hashlib.sha256(json.dumps(fingerprint_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    key = str(payload.request_id) if payload.request_id else None
    if key:
        receipt = await db.get(NoteCreateRequest, (user.id, key))
        if receipt:
            if receipt.fingerprint != fingerprint:
                raise HTTPException(409, "Mã yêu cầu đã được dùng cho một nội dung tạo khác.")
            note = await db.get(Note, receipt.note_id) if receipt.note_id else None
            if note is None:
                raise HTTPException(410, "Ghi chú của yêu cầu này đã bị xóa. Vui lòng đóng và tạo ghi chú mới nếu cần.")
            return await with_schedule(db, note)
    from app.modules.access.privacy import require_privacy_change
    await require_privacy_change(db, user.id, payload.is_private)
    note = Note(user_id=user.id, reminder_at=payload.reminder_at, pinned_at=utcnow() if data['is_pinned'] else None, **data)
    db.add(note)
    await db.flush()
    if payload.calendar_schedule:
        await save_schedule(db, note, payload.calendar_schedule)
    if not payload.calendar_schedule:
        await sync_note_reminder(db, note)
    if key:
        db.add(NoteCreateRequest(user_id=user.id, request_id=key, note_id=note.id, fingerprint=fingerprint))
    await db.flush()
    for topic in ("notes", "calendar"):
        mark_changed(db, user.id, topic)
    return await with_schedule(db, note)

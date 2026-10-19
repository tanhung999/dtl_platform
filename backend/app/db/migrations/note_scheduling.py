"""Bổ sung liên kết duy nhất cho lịch hẹn tạo từ ghi chú, không sửa dữ liệu cũ."""
from app.db.note_scheduling import NoteCalendarSchedule

async def migrate_note_scheduling(conn):
    await conn.run_sync(lambda sync: NoteCalendarSchedule.__table__.create(sync, checkfirst=True))

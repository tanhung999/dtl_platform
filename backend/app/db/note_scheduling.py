"""Một lịch hẹn riêng cho mỗi ghi chú."""
from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base

class NoteCalendarSchedule(Base):
    __tablename__ = "note_calendar_schedules"
    note_id: Mapped[str] = mapped_column(String(36), ForeignKey("notes.id", ondelete="CASCADE"), primary_key=True)
    event_id: Mapped[str] = mapped_column(String(36), ForeignKey("calendar_events.id", ondelete="CASCADE"), unique=True, nullable=False)

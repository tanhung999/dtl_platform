"""Persistent, user-owned calendar events; registered by the calendar router."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, Text, select

from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow
from app.db.note_scheduling import NoteCalendarSchedule
from sqlalchemy.orm import column_property


class CalendarEvent(Base):
    __tablename__ = "calendar_events"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="ck_calendar_events_time_range"),
        Index("ix_calendar_events_user_start", "user_id", "starts_at"),
        Index("ix_calendar_events_user_end", "user_id", "ends_at"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scheduled_note_id = column_property(
        select(NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id == id)
        .correlate_except(NoteCalendarSchedule).scalar_subquery()
    )
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=False, default="")
    location = Column(String(255), nullable=False, default="")
    starts_at = Column(UTCDateTime(), nullable=False)
    ends_at = Column(UTCDateTime(), nullable=False)
    is_all_day = Column(Boolean, nullable=False, default=False)
    is_private = Column(Boolean, nullable=False, default=False, server_default="false")
    color = Column(String(7), nullable=False, default="#2563eb")
    reminder_minutes = Column(Integer, nullable=True)
    reminder_at = Column(UTCDateTime(), nullable=True)
    reminder_version = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)

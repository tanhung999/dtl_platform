"""Persistent, user-owned calendar events; registered by the calendar router."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint, select, event, inspect

from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow
from app.db.note_scheduling import NoteCalendarSchedule
from sqlalchemy.orm import column_property, deferred, relationship


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
    search_text = deferred(Column(Text, nullable=False, default="", server_default=""))
    location = Column(String(255), nullable=False, default="")
    starts_at = Column(UTCDateTime(), nullable=False)
    ends_at = Column(UTCDateTime(), nullable=False)
    is_all_day = Column(Boolean, nullable=False, default=False)
    is_private = Column(Boolean, nullable=False, default=False, server_default="false")
    recurrence = Column(String(10), nullable=False, default="NONE", server_default="NONE")
    recurrence_until = Column(UTCDateTime(), nullable=True)
    color = Column(String(7), nullable=False, default="#2563eb")
    reminder_minutes = Column(Integer, nullable=True)
    reminder_at = Column(UTCDateTime(), nullable=True)
    reminder_version = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)

    follower_links = relationship("CalendarEventFollower", back_populates="event", cascade="all, delete-orphan")


class CalendarEventFollower(Base):
    __tablename__ = "calendar_event_followers"
    __table_args__ = (
        UniqueConstraint("event_id", "user_id", name="uq_calendar_event_followers_event_user"),
        Index("ix_calendar_event_followers_user", "user_id"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("calendar_events.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    added_by_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(UTCDateTime(), default=utcnow, nullable=False)

    event = relationship("CalendarEvent", back_populates="follower_links")
    user = relationship("User", foreign_keys=[user_id])
    added_by = relationship("User", foreign_keys=[added_by_id])


@event.listens_for(CalendarEvent, "before_insert")
@event.listens_for(CalendarEvent, "before_update")
def event_search_text(mapper, connection, item):
    from app.core.text_search import fold_text
    state = inspect(item)
    if state.pending or any(state.attrs[key].history.has_changes() for key in ("title", "description", "location")):
        item.search_text = fold_text(f"{item.title or ''}\n{item.description or ''}\n{item.location or ''}")

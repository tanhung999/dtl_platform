"""Only persist exceptions; regular occurrences remain projections of a series."""
from sqlalchemy import Column, ForeignKey, String
from app.core.database import Base
from app.db.types import UTCDateTime


class CalendarException(Base):
    __tablename__ = 'calendar_exceptions'
    event_id = Column(String(36), ForeignKey('calendar_events.id', ondelete='CASCADE'), primary_key=True)
    occurrence_at = Column(UTCDateTime(), primary_key=True)
    # Edited occurrences remain linked for whole-series deletion.
    replacement_id = Column(String(36), ForeignKey('calendar_events.id', ondelete='SET NULL'), nullable=True, unique=True)

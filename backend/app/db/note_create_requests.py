"""Durable creation receipts; deleted-note tombstones prevent accidental resurrection."""
from sqlalchemy import Column, ForeignKey, Index, String
from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow

class NoteCreateRequest(Base):
    __tablename__ = "note_create_requests"
    __table_args__ = (Index("ix_note_create_requests_note", "note_id"),)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    request_id = Column(String(36), primary_key=True)
    note_id = Column(String(36), ForeignKey("notes.id", ondelete="SET NULL"), nullable=True)
    fingerprint = Column(String(64), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)

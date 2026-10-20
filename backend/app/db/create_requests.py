"""Durable creation receipts survive resource deletion and lost HTTP responses."""
from sqlalchemy import Column, ForeignKey, String
from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow


class CreateRequest(Base):
    __tablename__ = "collection_create_requests"
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind = Column(String(16), primary_key=True)
    request_id = Column(String(36), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    # Intentionally no resource FK: a deleted resource must never be recreated by retry.
    resource_id = Column(String(36), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)

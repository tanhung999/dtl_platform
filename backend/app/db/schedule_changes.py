"""Lịch sử đổi lịch cá nhân; không sao chép nội dung Task/Notes/Sự kiện."""
import uuid
from sqlalchemy import Column, String, ForeignKey, JSON, Text, Index, UniqueConstraint
from app.core.database import Base
from app.db.models import utcnow
from app.db.types import UTCDateTime


class ScheduleChange(Base):
    __tablename__ = 'schedule_changes'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    request_id = Column(String(36), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    kind = Column(String(8), nullable=False)
    resource_id = Column(String(36), nullable=False)
    actor_name = Column(String(200), nullable=False)
    reason = Column(Text, nullable=False, default='')
    before = Column(JSON, nullable=False)
    after = Column(JSON, nullable=False)
    guard = Column(JSON, nullable=False)
    undone_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    __table_args__ = (
        UniqueConstraint('owner_id', 'request_id', name='uq_schedule_change_request'),
        Index('ix_schedule_changes_history', 'owner_id', 'kind', 'resource_id', 'created_at', 'id'),
        Index('ix_schedule_changes_retention', 'created_at', 'id'),
    )


class ScheduleChangeReceipt(Base):
    """Giữ mã đã dùng ngay cả khi lịch sử chi tiết hết hạn lưu giữ."""
    __tablename__ = 'schedule_change_receipts'
    owner_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    request_id = Column(String(36), primary_key=True)
    fingerprint = Column(String(64), nullable=False)
    change_id = Column(String(36), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)

"""Private persistent inbox, delivery queue and versioned recipient preferences."""
import uuid
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Index, Integer, String, UniqueConstraint, text
from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow


class Notification(Base):
    __tablename__ = 'notifications'
    __table_args__ = (
        UniqueConstraint('user_id', 'source', 'event_key', name='uq_notification_delivery'),
        CheckConstraint("source IN ('platform','bookingreports','workflows','itam')", name='ck_notification_source'),
        Index('ix_notifications_feed', 'user_id', 'dismissed_at', 'created_at', 'id'),
        Index('ix_notifications_unread', 'user_id', 'created_at', 'id', postgresql_where=text('read_at IS NULL AND dismissed_at IS NULL'), sqlite_where=text('read_at IS NULL AND dismissed_at IS NULL')),
    )
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    # Only shared deliveries carry an owner; NULL preserves existing personal history.
    calendar_owner_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=True, index=True)
    source = Column(String(20), nullable=False)
    event_key = Column(String(200), nullable=False)
    fingerprint = Column(String(64), nullable=False)
    kind = Column(String(40), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(String(1200), nullable=False, default='')
    resource_type = Column(String(40), nullable=False, default='')
    resource_id = Column(String(128), nullable=False, default='')
    action_path = Column(String(500), nullable=False, default='')
    note_id = Column(String(36), ForeignKey('notes.id', ondelete='SET NULL'), nullable=True, index=True)
    task_id = Column(String(36), ForeignKey('tasks.id', ondelete='SET NULL'), nullable=True, index=True)
    event_id = Column(String(36), ForeignKey('calendar_events.id', ondelete='SET NULL'), nullable=True, index=True)
    reminder_version = Column(Integer, nullable=True)
    deadline_version = Column(Integer, nullable=True)
    due_at = Column(UTCDateTime(), nullable=True)
    occurred_at = Column(UTCDateTime(), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    read_at = Column(UTCDateTime(), nullable=True)
    dismissed_at = Column(UTCDateTime(), nullable=True)
    snoozed_until = Column(UTCDateTime(), nullable=True)


class NotificationJob(Base):
    __tablename__ = 'notification_jobs'
    __table_args__ = (
        Index('ix_notification_jobs_due', 'available_at', 'id', postgresql_where=text('processed_at IS NULL'), sqlite_where=text('processed_at IS NULL')),
        Index('ix_notification_jobs_retention', 'processed_at', 'id', postgresql_where=text('processed_at IS NOT NULL'), sqlite_where=text('processed_at IS NOT NULL')),
    )
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    note_id = Column(String(36), ForeignKey('notes.id', ondelete='CASCADE'), nullable=True, index=True)
    task_id = Column(String(36), ForeignKey('tasks.id', ondelete='CASCADE'), nullable=True, index=True)
    event_id = Column(String(36), ForeignKey('calendar_events.id', ondelete='CASCADE'), nullable=True, index=True)
    reminder_version = Column(Integer, nullable=True)
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    deadline_version = Column(Integer, nullable=False)
    kind = Column(String(20), nullable=False)
    event_key = Column(String(200), nullable=False, unique=True)
    scheduled_at = Column(UTCDateTime(), nullable=False)
    available_at = Column(UTCDateTime(), nullable=False)
    processed_at = Column(UTCDateTime(), nullable=True)


class NotificationPreference(Base):
    __tablename__ = 'notification_preferences'
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    task_reminders = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    bookingreports = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    workflows = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    itam = Column(Boolean, nullable=False, default=True, server_default=text('true'))
    version = Column(Integer, nullable=False, default=0, server_default='0')

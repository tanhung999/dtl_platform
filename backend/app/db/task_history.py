"""Immutable result history, separate from the task's current completion state."""
import uuid
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, Integer, String, UniqueConstraint, text
from app.core.database import Base
from app.db.types import UTCDateTime


class TaskResultHistory(Base):
    __tablename__ = 'task_result_history'
    __table_args__ = (
        UniqueConstraint('task_id', 'task_version', name='uq_task_result_history_version'),
        CheckConstraint("action IN ('COMPLETED','REOPENED','RESULT_UPDATED')", name='ck_task_result_history_action'),
    )
    id = Column(String(80), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String(36), ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False)
    task_version = Column(Integer, nullable=False)
    actor_id = Column(String(36), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    action = Column(String(20), nullable=False)
    note = Column(String(500), nullable=True)
    occurred_at = Column(UTCDateTime(), nullable=True)
    is_snapshot = Column(Boolean, nullable=False, default=False, server_default=text('false'))

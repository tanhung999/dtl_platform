import uuid
from sqlalchemy import Column, ForeignKey, Integer, String, UniqueConstraint
from app.db.types import UTCDateTime
from app.core.database import Base
from app.db.models import utcnow


class TaskReminderReceipt(Base):
    __tablename__ = "task_reminder_receipts"
    __table_args__ = (UniqueConstraint("task_id", "deadline_version", "kind", name="uq_task_reminder_receipt"),)
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String(36), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    deadline_version = Column(Integer, nullable=False)
    kind = Column(String(10), nullable=False)
    dismissed_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    snoozed_until = Column(UTCDateTime(), nullable=True)

import uuid
from datetime import datetime, timezone
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, JSON, CheckConstraint, Index
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.db.types import ISODate, ISOTime


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(80), unique=True, index=True, nullable=False)
    email = Column(String(120), unique=True, index=True, nullable=False)
    full_name = Column(String(120), nullable=False)
    role = Column(String(50), default="admin")  # admin, manager, user
    department = Column(String(100), default="Công Nghệ & Chuyển Đổi Số")
    job_title = Column(String(100), default="Quản Trị Viên Hệ Thống")
    employee_code = Column(String(50), default="DTL-001")
    phone = Column(String(30), default="0901.525.178")
    office_location = Column(String(150), default="Trụ sở chính - TP. Hồ Chí Minh")
    avatar_url = Column(String(255), nullable=True)
    bio = Column(Text, default="Quản trị viên cổng làm việc tập trung và phân quyền hệ thống Đông Tây Land.")
    allowed_apps = Column(String(255), default="bookingreports,workflows,itam")
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    # Relationships
    notes = relationship("Note", back_populates="user", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="user", cascade="all, delete-orphan")
    bookmarks = relationship("Bookmark", back_populates="user", cascade="all, delete-orphan")


class Note(Base):
    __tablename__ = "notes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), default="Ghi chú mới")
    content = Column(Text, default="")
    color = Column(String(30), default="#fef08a")  # Default sticky yellow
    is_pinned = Column(Boolean, default=False)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="notes")


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        CheckConstraint("priority IN ('LOW','MEDIUM','HIGH','URGENT')", name="ck_tasks_priority"),
        CheckConstraint("deadline_version >= 0", name="ck_tasks_deadline_version"),
        CheckConstraint("due_time IS NULL OR due_date IS NOT NULL", name="ck_tasks_time_requires_date"),
        Index("ix_tasks_user_deadline", "user_id", "is_completed", "due_date"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    priority = Column(String(20), default="MEDIUM", nullable=False)  # LOW, MEDIUM, HIGH, URGENT
    due_date = Column(ISODate, nullable=True)
    due_time = Column(ISOTime, nullable=True)
    legacy_due_date = Column(String(50), nullable=True)
    deadline_version = Column(Integer, nullable=False, default=0, server_default="0")
    is_completed = Column(Boolean, default=False, nullable=False)
    display_order = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

    user = relationship("User", back_populates="tasks")
    reminder_receipts = relationship("TaskReminderReceipt", cascade="all, delete-orphan")


class Bookmark(Base):
    __tablename__ = "bookmarks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    title = Column(String(120), nullable=False)
    url = Column(String(500), nullable=False)
    icon = Column(String(50), default="link")
    category = Column(String(80), default="Nội bộ")
    display_order = Column(Integer, default=0)
    is_global = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    user = relationship("User", back_populates="bookmarks")

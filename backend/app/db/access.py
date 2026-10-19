"""Capability roles and explicit, read-only calendar grants."""
import uuid
from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, Index, JSON
from app.core.database import Base
from app.db.models import utcnow

class AccessRole(Base):
    __tablename__ = 'access_roles'
    id = Column(String(80), primary_key=True)
    name = Column(String(160), nullable=False)

class AccessPermission(Base):
    __tablename__ = 'access_permissions'
    code = Column(String(100), primary_key=True)
    name = Column(String(160), nullable=False)

class RolePermission(Base):
    __tablename__ = 'access_role_permissions'
    role_id = Column(String(80), ForeignKey('access_roles.id', ondelete='CASCADE'), primary_key=True)
    permission_code = Column(String(100), ForeignKey('access_permissions.code', ondelete='CASCADE'), primary_key=True)

class UserRole(Base):
    __tablename__ = 'access_user_roles'
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    role_id = Column(String(80), ForeignKey('access_roles.id', ondelete='CASCADE'), primary_key=True)

class CalendarShare(Base):
    __tablename__ = 'calendar_shares'
    __table_args__ = (
        UniqueConstraint('owner_id', 'viewer_id', name='uq_calendar_share_pair'),
        CheckConstraint('owner_id <> viewer_id', name='ck_calendar_share_other_user'),
        CheckConstraint('share_events OR share_tasks OR share_notes', name='ck_calendar_share_scope'),
        CheckConstraint('version >= 0', name='ck_calendar_share_version'),
    )
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    viewer_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True)
    share_events = Column(Boolean, nullable=False, default=True)
    share_tasks = Column(Boolean, nullable=False, default=False)
    share_notes = Column(Boolean, nullable=False, default=False)
    version = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=utcnow, onupdate=utcnow)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class AccessAccountVersion(Base):
    __tablename__ = 'access_account_versions'
    __table_args__ = (CheckConstraint('version >= 0', name='ck_access_account_version'),)
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    version = Column(Integer, nullable=False, default=0)


class AccessAuditLog(Base):
    __tablename__ = 'access_audit_logs'
    __table_args__ = (
        Index('ix_access_audit_recent', 'created_at', 'id'),
        Index('ix_access_audit_subject', 'subject_id', 'created_at', 'id'),
    )
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    actor_id = Column(String(36), ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
    subject_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    actor_name = Column(String(120), nullable=False)
    subject_name = Column(String(120), nullable=False)
    actor_username = Column(String(80), nullable=False)
    subject_username = Column(String(80), nullable=False)
    action = Column(String(50), nullable=False)
    changes = Column(JSON, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=utcnow)

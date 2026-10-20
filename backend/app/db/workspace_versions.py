"""Một hàng phiên bản theo tài khoản; cập nhật cùng transaction với dữ liệu."""
from sqlalchemy import BigInteger, Column, ForeignKey, String
from app.core.database import Base

TOPICS = ('tasks', 'calendar', 'notes', 'notifications', 'calendar-sharing', 'shared-calendar', 'bookmarks')

class WorkspaceVersion(Base):
    __tablename__ = 'workspace_versions'
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    tasks = Column(BigInteger, nullable=False, default=0, server_default='0')
    calendar = Column(BigInteger, nullable=False, default=0, server_default='0')
    notes = Column(BigInteger, nullable=False, default=0, server_default='0')
    notifications = Column(BigInteger, nullable=False, default=0, server_default='0')
    calendar_sharing = Column(BigInteger, nullable=False, default=0, server_default='0')
    shared_calendar = Column(BigInteger, nullable=False, default=0, server_default='0')
    bookmarks = Column(BigInteger, nullable=False, default=0, server_default='0')

"""Cổng điều phối dọn dữ liệu để nhiều worker không cùng chạy một đợt."""
from sqlalchemy import Column, String
from app.core.database import Base
from app.db.types import UTCDateTime


class MaintenanceRun(Base):
    __tablename__ = 'maintenance_runs'
    name = Column(String(40), primary_key=True)
    started_at = Column(UTCDateTime(), nullable=False)

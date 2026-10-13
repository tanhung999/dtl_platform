from sqlalchemy import Column, ForeignKey, Integer, JSON, String
from app.core.database import Base


class WorkspaceLayout(Base):
    __tablename__ = "workspace_layouts"
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    kind = Column(String(20), primary_key=True)
    ordered_ids = Column(JSON, nullable=False, default=list)
    version = Column(Integer, nullable=False, default=0)

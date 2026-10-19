from sqlalchemy import CheckConstraint, Column, ForeignKey, Integer, JSON, String
from app.core.database import Base


class WorkspaceWidgetLayout(Base):
    __tablename__ = "workspace_widget_layouts"
    __table_args__ = (
        CheckConstraint("version >= 0", name="ck_widget_layout_version"),
        CheckConstraint("schema_version > 0", name="ck_widget_layout_schema_version"),
    )
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    columns = Column(JSON, nullable=False, default=dict)
    schema_version = Column(Integer, nullable=False, default=1)
    version = Column(Integer, nullable=False, default=0)

"""Create the personal widget layout table without altering existing item orders."""
from app.db.widget_layout import WorkspaceWidgetLayout


async def migrate_widget_layout(conn):
    await conn.run_sync(lambda sync: WorkspaceWidgetLayout.__table__.create(sync, checkfirst=True))

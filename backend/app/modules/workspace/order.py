"""Keep saved workspace orders free of deleted and archived item IDs."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.realtime import mark_changed
from app.db.models import User
from app.db.workspace_layout import WorkspaceLayout

APP_IDS = frozenset({"bookingreports", "workflows", "itam"})


def clean_order(ids, allowed):
    return list(dict.fromkeys(item for item in ids if item in allowed))


async def remove_order_ids(db: AsyncSession, kind: str, removed: set[str], user_id: str | None = None):
    # Use the same user -> layout lock order as save_layout, including global links.
    users = select(User.id).order_by(User.id).with_for_update()
    layouts = select(WorkspaceLayout).where(WorkspaceLayout.kind == kind).with_for_update()
    if user_id is not None:
        users = users.where(User.id == user_id)
        layouts = layouts.where(WorkspaceLayout.user_id == user_id)
    affected_users = (await db.execute(users)).scalars().all()
    if user_id is None and kind == "bookmarks":
        for owner_id in affected_users:
            mark_changed(db, owner_id, "bookmarks")
    rows = list((await db.scalars(layouts)).all())
    if kind == "notes" and user_id is not None and not rows:
        row = WorkspaceLayout(user_id=user_id, kind="notes", ordered_ids=[], version=0)
        db.add(row)
        rows.append(row)
    for layout in rows:
        cleaned = [item for item in layout.ordered_ids if item not in removed]
        if cleaned != layout.ordered_ids or (kind == "notes" and user_id is not None):
            layout.ordered_ids = cleaned
            layout.version += 1
            mark_changed(db, layout.user_id, "layout")

"""One-time removal of invalid IDs from existing saved workspace orders."""
from collections import defaultdict
from sqlalchemy import select, update
from app.db.models import Bookmark, Note
from app.db.workspace_layout import WorkspaceLayout
from app.modules.workspace.order import APP_IDS, clean_order


async def migrate_workspace_order_cleanup(conn):
    allowed = defaultdict(set)
    notes, bookmarks = Note.__table__.c, Bookmark.__table__.c
    for user_id, item_id in await conn.execute(select(notes.user_id, notes.id).where(notes.is_archived.is_(False))):
        allowed[(user_id, "notes")].add(item_id)
    global_links = set()
    for user_id, item_id, is_global in await conn.execute(select(bookmarks.user_id, bookmarks.id, bookmarks.is_global)):
        if is_global:
            global_links.add(item_id)
        else:
            allowed[(user_id, "bookmarks")].add(item_id)
    table = WorkspaceLayout.__table__
    for row in (await conn.execute(select(table).with_for_update())).mappings():
        valid = APP_IDS if row.kind == "apps" else allowed[(row.user_id, row.kind)]
        if row.kind == "bookmarks":
            valid = valid | global_links
        if row.kind not in {"apps", "bookmarks", "notes"}:
            continue
        cleaned = clean_order(row.ordered_ids or [], valid)
        if cleaned != row.ordered_ids:
            await conn.execute(update(table).where(table.c.user_id == row.user_id, table.c.kind == row.kind).values(ordered_ids=cleaned, version=row.version + 1))

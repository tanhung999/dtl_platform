"""Task revisions, indexed note order and PostgreSQL substring search indexes."""
from sqlalchemy import inspect, text
from app.core.database import Base
import json

async def migrate_collection_scaling(conn):
    for table, name, definition in [("tasks", "version", "INTEGER NOT NULL DEFAULT 0"), ("notes", "sort_order", "BIGINT NOT NULL DEFAULT 0")]:
        columns = await conn.run_sync(lambda sync, table=table: {c["name"] for c in inspect(sync).get_columns(table)})
        if name not in columns:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))
    owners = (await conn.execute(text("SELECT DISTINCT user_id FROM notes"))).scalars().all()
    for owner in owners:
        ids = (await conn.execute(text("SELECT id FROM notes WHERE user_id=:owner ORDER BY created_at DESC NULLS LAST, id"), {"owner": owner})).scalars().all()
        saved = await conn.scalar(text("SELECT ordered_ids FROM workspace_layouts WHERE user_id=:owner AND kind='notes'"), {"owner": owner})
        if isinstance(saved, str):
            saved = json.loads(saved)
        allowed = set(ids)
        ordered = list(dict.fromkeys([id for id in (saved or []) if id in allowed] + ids))
        if ordered:
            await conn.execute(text("UPDATE notes SET sort_order=:position WHERE id=:id"), [{"id": id, "position": i} for i, id in enumerate(ordered)])
    for index in Base.metadata.tables["notes"].indexes:
        await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))
    if conn.dialect.name == "postgresql":
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_search_trgm ON notes USING gin (search_text gin_trgm_ops)"))

"""Task revisions, indexed note order and PostgreSQL substring search indexes."""
from sqlalchemy import inspect, text
from app.core.database import Base

async def migrate_collection_scaling(conn):
    columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns("tasks")})
    if "version" not in columns:
        await conn.execute(text("ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 0"))
    for index in Base.metadata.tables["notes"].indexes:
        await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))
    if conn.dialect.name == "postgresql":
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_notes_search_trgm ON notes USING gin (search_text gin_trgm_ops)"))

"""Add note revision without replacing existing notes or their colors."""
from sqlalchemy import inspect, text

async def migrate_note_versions(conn):
    columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns("notes")})
    if "version" not in columns:
        await conn.execute(text("ALTER TABLE notes ADD COLUMN version INTEGER NOT NULL DEFAULT 0"))
    if conn.dialect.name == "postgresql":
        checks = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_check_constraints("notes")})
        if "ck_notes_version" not in checks:
            await conn.execute(text("ALTER TABLE notes ADD CONSTRAINT ck_notes_version CHECK (version >= 0)"))

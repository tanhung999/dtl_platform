"""Backfill normalized search without changing user content; add durable create receipts."""
from sqlalchemy import inspect, text
from app.core.database import Base
from app.core.text_search import fold_text
from app.db.note_create_requests import NoteCreateRequest

async def migrate_note_reliability(conn):
    for table, column, fields in [("notes", "search_text", "title, content")]:
        columns = await conn.run_sync(lambda sync, table=table: {c["name"] for c in inspect(sync).get_columns(table)})
        if column not in columns:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} TEXT NOT NULL DEFAULT ''"))
        last = ""
        while True:
            rows = (await conn.execute(text(f"SELECT id, {fields} FROM {table} WHERE id > :last ORDER BY id LIMIT 500"), {"last": last})).mappings().all()
            if not rows:
                break
            values = [{"row_id": row["id"], "value": fold_text("\n".join(str(row.get(field) or "") for field in fields.split(", ")))} for row in rows]
            await conn.execute(text(f"UPDATE {table} SET {column}=:value WHERE id=:row_id"), values)
            last = rows[-1]["id"]
    await conn.run_sync(lambda sync: NoteCreateRequest.__table__.create(sync, checkfirst=True))
    columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns("notes")})
    for index in Base.metadata.tables["notes"].indexes:
        if not {c.name for c in index.columns}.issubset(columns):
            continue
        await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))

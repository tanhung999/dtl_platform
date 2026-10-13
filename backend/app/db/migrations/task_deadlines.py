from datetime import date, datetime, timedelta, timezone
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncConnection


async def migrate_task_deadlines(conn: AsyncConnection):
    """Idempotent migration; preserve legacy labels rather than guess unknown dates."""
    if conn.dialect.name == "postgresql":
        await conn.execute(text("SELECT pg_advisory_xact_lock(721042026)"))
    columns = await conn.run_sync(lambda sync: (
        {column["name"] for column in inspect(sync).get_columns("tasks")}
        if inspect(sync).has_table("tasks") else set()
    ))
    if not columns:
        return
    native_date = await conn.run_sync(lambda sync: next(column['type'] for column in inspect(sync).get_columns('tasks') if column['name'] == 'due_date'))
    additions = {"due_time": "VARCHAR(5)", "legacy_due_date": "VARCHAR(50)",
                 "deadline_version": "INTEGER NOT NULL DEFAULT 0"}
    for name, definition in additions.items():
        if name not in columns:
            await conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {name} {definition}"))
    if str(native_date).upper() == 'DATE':
        return
    rows = (await conn.execute(text("SELECT id, due_date, created_at FROM tasks WHERE due_date IS NOT NULL"))).mappings().all()
    for row in rows:
        raw = row["due_date"]
        try:
            normalized = date.fromisoformat(raw).isoformat()
        except (ValueError, TypeError):
            created = row["created_at"]
            if isinstance(created, str):
                created = datetime.fromisoformat(created.replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            day = created.astimezone(timezone(timedelta(hours=7))).date()
            known = {"hôm nay": day, "ngày mai": day + timedelta(days=1),
                     "tuần này": day + timedelta(days=6 - day.weekday())}
            normalized = known.get(raw.strip().lower())
            normalized = normalized.isoformat() if normalized else None
            await conn.execute(text("UPDATE tasks SET legacy_due_date = COALESCE(legacy_due_date, :raw), due_date = :due WHERE id = :id"),
                               {"raw": raw, "due": normalized, "id": row["id"]})
            continue
        if normalized != raw:
            await conn.execute(text("UPDATE tasks SET due_date = :due WHERE id = :id"), {"due": normalized, "id": row["id"]})

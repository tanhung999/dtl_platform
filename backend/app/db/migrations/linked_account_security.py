"""Add central revocation generations without changing grants or business records."""

from sqlalchemy import inspect, text


async def migrate_linked_account_security(conn):
    tables = await conn.run_sync(lambda sync: set(inspect(sync).get_table_names()))
    if "users" in tables:
        columns = await conn.run_sync(
            lambda sync: {c["name"] for c in inspect(sync).get_columns("users")}
        )
        if "external_session_version" not in columns:
            await conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN external_session_version INTEGER NOT NULL DEFAULT 0"
                )
            )

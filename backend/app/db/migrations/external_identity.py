from sqlalchemy import inspect, text


async def migrate_external_identity(conn) -> None:
    columns = await conn.run_sync(
        lambda sync: {column["name"] for column in inspect(sync).get_columns("users")}
    )
    if "identity_subject" not in columns:
        await conn.execute(text("ALTER TABLE users ADD COLUMN identity_subject VARCHAR(255)"))
    await conn.execute(
        text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_identity_subject ON users (identity_subject)")
    )

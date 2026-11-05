"""Add source revision/visibility metadata without deleting existing inbox history."""

from sqlalchemy import inspect, text


async def migrate_notification_bridge(conn):
    names = await conn.run_sync(
        lambda sync: {
            c["name"] for c in inspect(sync).get_columns("external_notification_states")
        }
    )
    if "source_read_version" not in names:
        await conn.execute(
            text(
                "ALTER TABLE external_notification_states ADD COLUMN source_read_version INTEGER NOT NULL DEFAULT 0"
            )
        )
    if "source_visible" not in names:
        await conn.execute(
            text(
                "ALTER TABLE external_notification_states ADD COLUMN source_visible BOOLEAN NOT NULL DEFAULT TRUE"
            )
        )
    from app.db.notifications import ExternalNotificationState

    for index in ExternalNotificationState.__table__.indexes:
        await conn.run_sync(lambda sync, idx=index: idx.create(sync, checkfirst=True))

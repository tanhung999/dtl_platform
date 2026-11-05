"""Add external notification bindings and a durable read-state outbox; preserve inbox history."""

from app.db.notifications import ExternalNotificationState, NotificationReadOutbox


async def migrate_notification_sync(conn):
    for model in (ExternalNotificationState, NotificationReadOutbox):
        await conn.run_sync(
            lambda sync, table=model.__table__: table.create(sync, checkfirst=True)
        )

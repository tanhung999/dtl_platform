"""Legacy inbox bootstrap marker; user reminders are opt-in on every installation."""

async def migrate_notifications(conn):
    # Tables are created by metadata. Do not invent reminders for existing tasks.
    # notifications_002 removes pending jobs from pre-upgrade automatic scheduling.
    pass

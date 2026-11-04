"""Add the handover ledger without changing any existing application grants."""
from app.db.applications import ApplicationPolicyOwnership


async def migrate_application_policy_ownership(conn):
    await conn.run_sync(lambda sync: ApplicationPolicyOwnership.__table__.create(sync, checkfirst=True))

"""Enable the isolated local HRM registry entry and grant access to a linked user."""

import argparse
import asyncio

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_maker, engine
from app.db.applications import Application, UserApplicationAccess
from app.db.models import User


async def configure(username):
    if (
        settings.APP_ENV != "development"
        or settings.OIDC_FRONTEND_URL != "http://localhost:15173"
        or not settings.OIDC_ENABLED
        or not settings.INTEGRATION_HRM_SECRET
    ):
        raise SystemExit("Use the isolated platform-hrm-sso Compose project.")
    try:
        async with async_session_maker() as db, db.begin():
            app = await db.get(Application, "hrm")
            user = await db.scalar(select(User).where(User.username == username))
            if not app or not user or not user.identity_subject or not user.is_active:
                raise SystemExit("Start Platform and provision the test user in Keycloak first.")
            app.launch_url = "http://localhost:18088"
            app.callback_path = "/api/auth/platform/callback"
            app.is_active = True
            grant = await db.get(UserApplicationAccess, (user.id, app.key))
            if not grant:
                db.add(UserApplicationAccess(user_id=user.id, application_key=app.key, enabled=True))
            else:
                grant.enabled = True
        print(user.identity_subject)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("username")
    args = parser.parse_args()
    asyncio.run(configure(args.username))

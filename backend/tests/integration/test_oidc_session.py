import hashlib
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

from app.core.config import Settings, settings
from app.db.applications import OidcSession
from app.db.models import User
from tests.support.api_case import ApiTestCase


class OidcSessionTests(ApiTestCase):
    async def test_production_rejects_sample_secrets(self):
        production = Settings(
            APP_ENV="production",
            ALLOW_INSECURE_LOCAL_CONFIG=False,
            OIDC_ENABLED=True,
            OIDC_SESSION_COOKIE_SECURE=False,
            SECRET_KEY="change-me",
            SSO_SECRET_KEY="change-me",
            OIDC_CLIENT_SECRET="change-me",
            OIDC_SESSION_ENCRYPTION_SECRET="change-me",
            INTEGRATION_SHARED_SECRET="change-me",
            KEYCLOAK_ADMIN_CLIENT_SECRET="change-me",
        )
        with self.assertRaises(RuntimeError):
            production.validate_production()

    async def test_platform_form_authenticates_through_oidc_backend(self):
        previous = settings.OIDC_ENABLED
        settings.OIDC_ENABLED = True
        try:
            async with self.sessions() as db:
                alice = await db.get(User, "alice")
            with patch(
                "app.modules.auth.router.authenticate_password",
                new=AsyncMock(return_value=(alice, "opaque-platform-session")),
            ):
                status, body = await self.request(
                    "POST",
                    "/api/auth/login",
                    user=None,
                    payload={"username": "alice", "password": "test-password"},
                )
        finally:
            settings.OIDC_ENABLED = previous
        self.assertEqual(status, 200)
        self.assertEqual(body["token_type"], "cookie")
        self.assertEqual(body["access_token"], "")
        self.assertEqual(body["user"]["username"], "alice")

    async def test_opaque_cookie_authentication_and_revocation(self):
        token = "opaque-test-session"
        async with self.sessions() as db:
            db.add(OidcSession(
                token_hash=hashlib.sha256(token.encode()).hexdigest(),
                user_id="alice",
                expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ))
            await db.commit()

        cookie = f"{settings.OIDC_SESSION_COOKIE_NAME}={token}"
        status, profile = await self.request(
            "GET", "/api/auth/me", user=None, headers_extra={"Cookie": cookie}
        )
        self.assertEqual(status, 200)
        self.assertEqual(profile["username"], "alice")

        status, result = await self.request(
            "POST", "/api/auth/oidc/logout", user=None, headers_extra={"Cookie": cookie}
        )
        self.assertEqual(status, 200)
        self.assertIsNone(result["logout_url"])
        status, _ = await self.request(
            "GET", "/api/auth/me", user=None, headers_extra={"Cookie": cookie}
        )
        self.assertEqual(status, 401)

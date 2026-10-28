"""HTTP opt-in, cookie CSRF, password revocation and explicit account linking."""
from tests.support.api_case import ApiTestCase

import hashlib
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.db.applications import OidcSession
from app.db.models import User, Note
from app.main import app
from app.modules.auth.identity_setup import provision_user, IdentitySetupError
from app.modules.auth.oidc import end_user_sessions
from app.modules.auth.schemas import ChangePasswordRequest


class IdentityHttpTests(ApiTestCase):
    async def test_seven_character_new_passwords_are_rejected_before_identity_calls(self):
        from pydantic import ValidationError
        from app.modules.users.router import UserCreate, PasswordReset
        for schema, values in (
            (UserCreate, {'username': 'new.user', 'email': 'new@example.com', 'full_name': 'New User', 'password': 'Ab@1234'}),
            (PasswordReset, {'password': 'Ab@1234'}),
            (ChangePasswordRequest, {'current_password': 'old-password', 'new_password': 'Ab@1234'}),
        ):
            with self.subTest(schema=schema.__name__), self.assertRaises(ValidationError):
                schema(**values)
        with patch('app.modules.auth.identity_setup.async_session_maker', self.sessions), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.create_user', new=AsyncMock()) as create:
            with self.assertRaises(ValueError):
                await provision_user('alice', 'Ab@1234')
            create.assert_not_awaited()

    def test_existing_long_password_is_not_rejected_by_change_form_schema(self):
        request = ChangePasswordRequest(current_password='old-password-' * 30, new_password='new-safe-password')
        self.assertGreater(len(request.current_password), 128)

    def test_standalone_cli_registers_user_foreign_keys(self):
        result = subprocess.run([sys.executable, '-c',
            'from app.modules.auth.identity_setup import User; '
            'assert all(f.column is not None for f in User.__table__.foreign_keys)'],
            env={**os.environ, 'DEBUG': 'false', 'DATABASE_URL': 'sqlite+aiosqlite:///:memory:'},
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def production(self, **changes):
        values = {key: 'test-strong-credential-' + key + '-1234567890' for key in (
            'SECRET_KEY', 'SSO_SECRET_KEY', 'OIDC_CLIENT_SECRET', 'OIDC_SESSION_ENCRYPTION_SECRET',
            'INTEGRATION_BOOKINGREPORTS_SECRET', 'INTEGRATION_WORKFLOWS_SECRET', 'INTEGRATION_ITAM_SECRET',
            'KEYCLOAK_ADMIN_CLIENT_SECRET')}
        return Settings(_env_file=None, **{**values, 'APP_ENV': 'production', 'ALLOW_INSECURE_LOCAL_CONFIG': False,
            'OIDC_ENABLED': True, 'OIDC_FRONTEND_URL': 'http://platform.dongtayland.vn:8080',
            'OIDC_SESSION_COOKIE_SECURE': False, **changes})

    def test_http_requires_explicit_exception_and_still_validates_secrets(self):
        with self.assertRaises(RuntimeError):
            self.production().validate_production()
        self.production(OIDC_ALLOW_HTTP=True).validate_production()
        with self.assertRaises(RuntimeError):
            self.production(OIDC_ALLOW_HTTP=True, SECRET_KEY='change-me').validate_production()
        with self.assertRaises(RuntimeError):
            self.production(OIDC_ALLOW_HTTP=True, OIDC_SESSION_COOKIE_SECURE=True).validate_production()
        with self.assertRaises(RuntimeError):
            self.production(OIDC_ALLOW_HTTP=True, OIDC_FRONTEND_URL='https://platform.example.com').validate_production()
        with self.assertRaises(RuntimeError):
            self.production(OIDC_ALLOW_HTTP=True, OIDC_FRONTEND_URL='http://platform.example.com:bad').validate_production()
        self.production(OIDC_FRONTEND_URL='https://platform.example.com', OIDC_SESSION_COOKIE_SECURE=True).validate_production()

    async def seed_cookie(self, expired=False):
        token = 'test-opaque-identity-cookie'
        async with self.sessions() as db:
            db.add(OidcSession(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id='alice',
                expires_at=datetime.now(timezone.utc) + timedelta(hours=-1 if expired else 1)))
            await db.commit()
        return {"Cookie": f'{settings.OIDC_SESSION_COOKIE_NAME}={token}'}

    async def test_cookie_write_rejects_missing_header_foreign_origin_and_cross_site(self):
        cookie = await self.seed_cookie()
        endpoint = '/api/auth/profile'
        cases = [cookie, {**cookie, 'X-Platform-Request': '1', 'Origin': 'http://evil.example'},
            {**cookie, 'X-Platform-Request': '1', 'Origin': 'null'},
            {**cookie, 'X-Platform-Request': '1', 'Sec-Fetch-Site': 'cross-site'}]
        for headers in cases:
            with self.subTest(headers=headers):
                code, _ = await self.request('PUT', endpoint, user=None, payload={'full_name': 'Changed'}, headers_extra=headers)
                self.assertEqual(code, 403)
        code, _ = await self.request('PUT', endpoint, user=None, payload={'full_name': 'Changed'},
            headers_extra={**cookie, 'X-Platform-Request': '1', 'Origin': settings.OIDC_FRONTEND_URL})
        self.assertEqual(code, 200)

    async def test_http_login_returns_only_opaque_httponly_cookie(self):
        async with self.sessions() as db:
            alice = await db.get(User, 'alice')
        with patch.object(settings, 'OIDC_ENABLED', True), patch.object(settings, 'OIDC_SESSION_COOKIE_SECURE', False), patch(
            'app.modules.auth.router.authenticate_password', new=AsyncMock(return_value=(alice, 'opaque-cookie'))
        ):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=settings.OIDC_FRONTEND_URL) as client:
                bad = await client.post('/api/auth/login', json={'username': 'alice', 'password': 'secret'})
                self.assertEqual(bad.status_code, 403)
                response = await client.post('/api/auth/login', json={'username': 'alice', 'password': 'secret'},
                    headers={'X-Platform-Request': '1', 'Origin': settings.OIDC_FRONTEND_URL})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['access_token'], '')
        self.assertEqual(response.json()['token_type'], 'cookie')
        cookie = response.headers['set-cookie'].lower()
        self.assertIn('httponly', cookie)
        self.assertIn('samesite=lax', cookie)
        self.assertNotIn('secure', cookie)

    async def test_production_frontend_json_writes_work_during_rollout_without_new_header(self):
        cookie = await self.seed_cookie()
        trusted = {**cookie, 'Origin': settings.OIDC_FRONTEND_URL}
        code, _ = await self.request('PUT', '/api/auth/profile', user=None,
            payload={'full_name': 'Existing frontend'}, headers_extra=trusted)
        self.assertEqual(code, 200)
        # Same-site siblings, alternate ports and form content types are not trusted.
        expected = urlsplit(settings.OIDC_FRONTEND_URL)
        other_port = (expected.port or (443 if expected.scheme == 'https' else 80)) + 1
        for origin in ('http://workflow.dongtayland.vn:8080', f'{expected.scheme}://{expected.hostname}.evil.example:{expected.port or 80}',
                       f'{expected.scheme}://{expected.hostname}:{other_port}'):
            code, _ = await self.request('PUT', '/api/auth/profile', user=None,
                payload={'full_name': 'Blocked'}, headers_extra={**cookie, 'Origin': origin})
            self.assertEqual(code, 403)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url=settings.OIDC_FRONTEND_URL) as client:
            for content_type in ('text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'):
                response = await client.put('/api/auth/profile', content='{}',
                    headers={**trusted, 'Content-Type': content_type})
                self.assertEqual(response.status_code, 403)
        with patch.object(settings, 'OIDC_ENABLED', True), patch('app.modules.auth.router.authenticate_password',
            new=AsyncMock(side_effect=HTTPException(401, 'Wrong password'))):
            code, _ = await self.request('POST', '/api/auth/login', user=None,
                payload={'username': 'alice', 'password': 'wrong'}, headers_extra={'Origin': settings.OIDC_FRONTEND_URL})
        self.assertEqual(code, 401)  # Authentication reached, rather than blocked by rollout CSRF.

    async def test_expired_and_revoked_cookies_are_not_accepted(self):
        cookie = await self.seed_cookie(expired=True)
        self.assertEqual((await self.request('GET', '/api/auth/me', user=None, headers_extra=cookie))[0], 401)
        async with self.sessions() as db:
            row = await db.scalar(select(OidcSession))
            row.expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
            alice = await db.get(User, 'alice')
            with patch('app.modules.users.keycloak.keycloak_user_admin.logout_user', new=AsyncMock(side_effect=HTTPException(503))):
                await end_user_sessions(db, alice)
            await db.commit()
        self.assertEqual((await self.request('GET', '/api/auth/me', user=None, headers_extra=cookie))[0], 401)

    async def test_account_link_preserves_id_password_and_notes_and_refuses_overwrite(self):
        async with self.sessions() as db:
            alice = await db.get(User, 'alice')
            previous_hash = alice.password_hash
            db.add(Note(user_id='alice', title='Preserved', content='Keep me'))
            await db.commit()
        with patch('app.modules.auth.identity_setup.async_session_maker', self.sessions), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.create_user', new=AsyncMock(return_value='kc-alice')) as create:
            await provision_user('alice', 'new-safe-test-password')
            with self.assertRaises(ValueError):
                await provision_user('alice', 'new-safe-test-password')
            create.assert_awaited_once()
        async with self.sessions() as db:
            alice = await db.get(User, 'alice')
            self.assertEqual(alice.identity_subject, 'kc-alice')
            self.assertEqual(alice.password_hash, previous_hash)
            self.assertEqual((await db.scalar(select(Note))).user_id, 'alice')

    async def test_lost_commit_reply_keeps_confirmed_keycloak_identity(self):
        commit = AsyncSession.commit
        async def lost_reply(session):
            await commit(session)
            raise RuntimeError('Commit reply interrupted')
        with patch('app.modules.auth.identity_setup.async_session_maker', self.sessions), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.create_user', new=AsyncMock(return_value='kc-alice')), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.delete_user', new=AsyncMock()) as remove, patch.object(
            AsyncSession, 'commit', lost_reply):
            await provision_user('alice', 'new-safe-test-password')
            remove.assert_not_awaited()
        async with self.sessions() as db:
            self.assertEqual((await db.get(User, 'alice')).identity_subject, 'kc-alice')

    async def test_unconfirmed_commit_never_deletes_remote_identity(self):
        first_session = self.sessions()
        with patch('app.modules.auth.identity_setup.async_session_maker', side_effect=[first_session, RuntimeError('Unavailable')]), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.create_user', new=AsyncMock(return_value='kc-alice')), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.delete_user', new=AsyncMock()) as remove, patch.object(
            AsyncSession, 'commit', new=AsyncMock(side_effect=RuntimeError('Interrupted'))):
            with self.assertRaises(IdentitySetupError):
                await provision_user('alice', 'new-safe-test-password')
            remove.assert_not_awaited()

    async def test_self_password_change_revokes_existing_cookie(self):
        cookie = await self.seed_cookie()
        async with self.sessions() as db:
            alice = await db.get(User, 'alice'); alice.identity_subject = 'kc-alice'; await db.commit()
        with patch.object(settings, 'OIDC_ENABLED', True), patch('app.modules.auth.router.authenticate_password',
            new=AsyncMock(return_value=(alice, 'ignored'))), patch('app.modules.users.keycloak.keycloak_user_admin.reset_password',
            new=AsyncMock()) as reset, patch('app.modules.users.keycloak.keycloak_user_admin.logout_user', new=AsyncMock()):
            code, body = await self.request('POST', '/api/auth/change-password', user=None,
                payload={'current_password': 'old-password', 'new_password': 'Next@123'},
                headers_extra={**cookie, 'X-Platform-Request': '1'})
        self.assertEqual(code, 200)
        self.assertTrue(body['reauthenticate'])
        reset.assert_awaited_once_with('kc-alice', 'Next@123')
        self.assertEqual((await self.request('GET', '/api/auth/me', user=None, headers_extra=cookie))[0], 401)

    async def test_linking_inactive_user_preserves_disabled_state(self):
        async with self.sessions() as db:
            bob = await db.get(User, 'bob'); bob.is_active = False; await db.commit()
        with patch('app.modules.auth.identity_setup.async_session_maker', self.sessions), patch(
            'app.modules.auth.identity_setup.keycloak_user_admin.create_user', new=AsyncMock(return_value='kc-bob')) as create:
            await provision_user('bob', 'new-safe-test-password')
        self.assertFalse(create.call_args.kwargs['enabled'])
        async with self.sessions() as db:
            bob = await db.get(User, 'bob')
            self.assertFalse(bob.is_active)
            self.assertEqual(bob.identity_subject, 'kc-bob')

    async def test_wrong_current_password_does_not_log_user_out(self):
        cookie = await self.seed_cookie()
        async with self.sessions() as db:
            alice = await db.get(User, 'alice'); alice.identity_subject = 'kc-alice'; await db.commit()
        with patch.object(settings, 'OIDC_ENABLED', True), patch('app.modules.auth.router.authenticate_password',
            new=AsyncMock(side_effect=HTTPException(401))):
            code, _ = await self.request('POST', '/api/auth/change-password', user=None,
                payload={'current_password': 'wrong', 'new_password': 'new-safe-test-password'},
                headers_extra={**cookie, 'X-Platform-Request': '1'})
        self.assertEqual(code, 400)
        self.assertEqual((await self.request('GET', '/api/auth/me', user=None, headers_extra=cookie))[0], 200)

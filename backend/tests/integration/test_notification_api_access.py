"""API hộp thư dùng chung: xác thực từng ứng dụng, cô lập người dùng, phân trang và token giới hạn."""
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from unittest.mock import patch
import jwt
from sqlalchemy import event
from tests.support.api_case import ApiTestCase
from app.core.config import settings
from app.core.security import create_sso_ticket
from app.db.models import User
from app.db.notifications import Notification

SIGNING = 'platform-only-signing-key-for-tests-123456'
SECRETS = {source: source + '-private-api-secret-for-tests-123456' for source in ('bookingreports', 'workflows', 'itam')}


class NotificationApiAccessTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        for key, value in {'NOTIFICATIONS_API_SIGNING_SECRET': SIGNING, **{
            f'NOTIFICATIONS_{source.upper()}_API_SECRET': secret for source, secret in SECRETS.items()}}.items():
            setting = patch.object(settings, key, value)
            setting.start()
            self.addCleanup(setting.stop)
        async with self.sessions() as db:
            for name in ('alice', 'bob'):
                user = await db.get(User, name)
                user.allowed_apps = 'bookingreports,workflows,itam'
            now = datetime.now(timezone.utc)
            for owner in ('alice', 'bob'):
                for i in range(6):
                    db.add(Notification(user_id=owner, source='workflows', event_key=str(i), fingerprint='test', kind='external.info',
                                        title=f'{owner}-{i}', resource_type='workflows.record', resource_id=str(i), action_path=f'/records/{i}',
                                        occurred_at=now, created_at=now))
            await db.commit()

    def ticket(self, source='workflows', user='alice'):
        return create_sso_ticket({'id': user, 'username': user, 'email': user+'@example.com', 'full_name': user}, source)

    async def exchange(self, payload=None, source='workflows', *, secret=None, timestamp=None, extra=None):
        payload = payload if payload is not None else {'sso_ticket': self.ticket(source)}
        stamp = str(timestamp if timestamp is not None else int(time.time()))
        body = json.dumps(payload).encode()
        signature = hmac.new((secret or SECRETS[source]).encode(), f'{stamp}\n{source}\nnotification-token\n'.encode()+body, hashlib.sha256).hexdigest()
        return await self.request('POST', f'/api/integrations/{source}/notification-token', user=None, payload=payload,
                                  headers_extra={'X-Notification-Timestamp': stamp, 'X-Notification-Signature': 'sha256='+signature, **(extra or {})})

    async def delegated(self, method, path='/api/notifications', token=None, **kwargs):
        if token is None:
            code, issued = await self.exchange()
            self.assertEqual(code, 200)
            token = issued['access_token']
        return await self.request(method, path, user=None, headers_extra={'Authorization': 'Bearer '+token}, **kwargs)

    async def test_all_three_apps_read_same_inbox_and_cursor_has_no_cross_account_data(self):
        for source in SECRETS:
            code, issued = await self.exchange(source=source)
            self.assertEqual(code, 200)
            self.assertEqual(issued['expires_in'], settings.NOTIFICATIONS_API_TOKEN_SECONDS)
            code, first = await self.delegated('GET', token=issued['access_token'], query={'limit': 4, 'user_id': 'bob'})
            self.assertEqual(code, 200)
            self.assertEqual(len(first['items']), 4)
            self.assertTrue(first['has_more'])
            code, second = await self.delegated('GET', token=issued['access_token'], query={'limit': 4, 'before': first['next_cursor']})
            self.assertEqual(code, 200)
            items = first['items'] + second['items']
            self.assertEqual(len({row['id'] for row in items}), 6)
            self.assertTrue(all(row['title'].startswith('alice-') for row in items))
            _, summary = await self.delegated('GET', '/api/notifications/summary', issued['access_token'])
            self.assertEqual(summary['unread_count'], 6)

    async def test_read_hide_and_read_all_are_shared_with_platform(self):
        _, feed = await self.delegated('GET')
        notice = feed['items'][0]
        path = '/api/notifications/' + notice['id']
        self.assertEqual((await self.delegated('PATCH', path, payload={'read': True}))[0], 204)
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 5)
        self.assertEqual((await self.delegated('PATCH', path, payload={'dismissed': True}))[0], 204)
        self.assertEqual(len((await self.request('GET', '/api/notifications', query={'filter': 'hidden'}))[1]['items']), 1)
        self.assertEqual((await self.delegated('POST', '/api/notifications/read-all', payload={'through': feed['server_now']}))[0], 204)
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 0)
        self.assertEqual((await self.delegated('GET', path+'/destination'))[1]['target_app'], 'workflows')

    async def test_other_account_notification_is_not_accessible(self):
        _, bob = await self.request('GET', '/api/notifications', user='bob')
        path = '/api/notifications/' + bob['items'][0]['id']
        self.assertEqual((await self.delegated('PATCH', path, payload={'read': True}))[0], 404)
        self.assertEqual((await self.delegated('GET', path+'/destination'))[0], 404)

    async def test_token_cannot_access_other_modules_or_notification_preferences(self):
        _, issued = await self.exchange()
        token = issued['access_token']
        for path in ('/api/auth/me', '/api/tasks', '/api/notes', '/api/calendar/events'):
            self.assertEqual((await self.delegated('GET', path, token))[0], 401)
        self.assertEqual((await self.delegated('GET', '/api/notifications/preferences', token))[0], 403)
        self.assertEqual((await self.delegated('PATCH', '/api/notifications/preferences', token, payload={'expected_version': 0, 'task_reminders': False}))[0], 403)
        self.assertEqual((await self.delegated('POST', '/api/notifications/example/snooze', token))[0], 403)

    async def test_renewal_keeps_original_session_deadline_and_app_binding(self):
        _, first = await self.exchange()
        code, renewed = await self.exchange({'access_token': first['access_token']})
        self.assertEqual(code, 200)
        self.assertEqual(renewed['session_expires_at'], first['session_expires_at'])
        self.assertNotEqual(first['access_token'], renewed['access_token'])
        self.assertEqual((await self.exchange({'access_token': first['access_token']}, source='itam'))[0], 401)
        self.assertEqual((await self.exchange({'sso_ticket': self.ticket('itam')}))[0], 401)
        self.assertEqual((await self.exchange({'access_token': self.tokens['alice']}))[0], 401)
        claims = jwt.decode(first['access_token'], SIGNING, algorithms=['HS256'], audience='dtl-notifications')
        expired = jwt.encode({**claims, 'iat': int(time.time())-1000, 'exp': int(time.time())-1}, SIGNING, algorithm='HS256')
        self.assertEqual((await self.delegated('GET', token=expired))[0], 401)
        code, resumed = await self.exchange({'access_token': expired})
        self.assertEqual(code, 200)
        self.assertEqual(resumed['session_expires_at'], first['session_expires_at'])
        ended = jwt.encode({**claims, 'exp': 1, 'session_exp': 1}, SIGNING, algorithm='HS256')
        self.assertEqual((await self.exchange({'access_token': ended}))[0], 401)

    async def test_expired_tampered_tokens_and_read_only_scope(self):
        _, issued = await self.exchange()
        claims = jwt.decode(issued['access_token'], SIGNING, algorithms=['HS256'], audience='dtl-notifications')
        for edits in ({'exp': 1}, {'session_exp': 1}, {'token_use': 'access'}, {'aud': 'wrong'}):
            token = jwt.encode({**claims, **edits}, SIGNING, algorithm='HS256')
            self.assertEqual((await self.delegated('GET', token=token))[0], 401)
        read_only = jwt.encode({**claims, 'scope': ['notifications:read']}, SIGNING, algorithm='HS256')
        self.assertEqual((await self.delegated('GET', token=read_only))[0], 200)
        _, feed = await self.request('GET', '/api/notifications')
        self.assertEqual((await self.delegated('PATCH', '/api/notifications/'+feed['items'][0]['id'], read_only, payload={'read': True}))[0], 403)
        _, renewed = await self.exchange({'access_token': read_only})
        self.assertEqual(renewed['scope'], 'notifications:read')

    async def test_disabled_account_revocation_and_rotated_key_take_effect_immediately(self):
        _, issued = await self.exchange()
        async with self.sessions() as db:
            user = await db.get(User, 'alice'); user.allowed_apps = 'itam'
            await db.commit()
        self.assertEqual((await self.delegated('GET', token=issued['access_token']))[0], 403)
        self.assertEqual((await self.exchange({'access_token': issued['access_token']}))[0], 403)
        async with self.sessions() as db:
            user = await db.get(User, 'alice'); user.allowed_apps = 'workflows'; user.is_active = False
            await db.commit()
        self.assertEqual((await self.delegated('GET', token=issued['access_token']))[0], 401)
        self.assertEqual((await self.exchange())[0], 401)
        with patch.object(settings, 'NOTIFICATIONS_WORKFLOWS_API_SECRET', 'rotated-private-key-for-tests-123456'):
            self.assertEqual((await self.delegated('GET', token=issued['access_token']))[0], 401)

    async def test_signature_expiry_input_validation_and_disabled_configuration(self):
        self.assertEqual((await self.exchange(secret=SECRETS['itam']))[0], 401)
        self.assertEqual((await self.exchange(timestamp=int(time.time())-600))[0], 401)
        self.assertEqual((await self.exchange({'user_id': 'bob'}))[0], 422)
        self.assertEqual((await self.exchange({'sso_ticket': self.ticket(), 'access_token': 'both'}))[0], 422)
        self.assertEqual((await self.exchange({'sso_ticket': 'x'*17000}))[0], 413)
        with patch.object(settings, 'NOTIFICATIONS_API_SIGNING_SECRET', ''):
            self.assertEqual((await self.exchange())[0], 503)
        with patch.object(settings, 'NOTIFICATIONS_WORKFLOWS_API_SECRET', ''):
            self.assertEqual((await self.exchange())[0], 503)
        self.assertEqual((await self.delegated('GET', query={'limit': 1000}))[0], 422)
        self.assertEqual((await self.delegated('GET', query={'before': 'invalid!'}))[0], 422)

    async def test_feed_has_bounded_queries_and_repeated_read_is_a_noop(self):
        _, issued = await self.exchange()
        statements = []
        def observe(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement.lstrip().split()[0].upper())
        event.listen(self.engine.sync_engine, 'before_cursor_execute', observe)
        try:
            for limit in (1, 50):
                statements.clear()
                code, feed = await self.delegated('GET', token=issued['access_token'], query={'limit': limit})
                self.assertEqual(code, 200)
                self.assertEqual(statements.count('SELECT'), 2)
            path = '/api/notifications/' + feed['items'][0]['id']
            await self.delegated('PATCH', path, issued['access_token'], payload={'read': True})
            statements.clear()
            self.assertEqual((await self.delegated('PATCH', path, issued['access_token'], payload={'read': True}))[0], 204)
            self.assertFalse(set(statements) & {'INSERT', 'UPDATE', 'DELETE'})
        finally:
            event.remove(self.engine.sync_engine, 'before_cursor_execute', observe)

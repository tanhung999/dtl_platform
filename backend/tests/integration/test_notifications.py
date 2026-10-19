"""Persistent private inbox, durable deadlines, bounded queries and authenticated integrations."""
import hashlib
import hmac
import json
import time
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import func, select
from tests.support import api_case as test_calendar
from app.core.config import settings
from app.db.models import Task
from app.db.notifications import Notification, NotificationJob
from app.modules.notifications.worker import deliver_batch
from app.db.migrations.notifications import migrate_notifications

UTC = timezone.utc
CREATED = datetime(2026, 10, 18, tzinfo=UTC)
BEFORE = datetime(2026, 10, 19, 1, tzinfo=UTC)
DAY = datetime(2026, 10, 20, 1, tzinfo=UTC)
DUE = datetime(2026, 10, 20, 9, tzinfo=UTC)

class NotificationsTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def task(self, **changes):
        with patch('app.modules.tasks.router.utcnow', return_value=CREATED):
            code, task = await self.request('POST', '/api/tasks', payload={'title': 'Offline deadline', 'due_date': '2026-10-20', 'due_time': '16:00', **changes})
        self.assertEqual(code, 201)
        return task

    async def tick(self, now):
        async with self.sessions() as db:
            count = await deliver_batch(db, now)
            await db.commit()
            return count

    async def test_server_generates_history_without_browser_and_never_duplicates(self):
        task = await self.task()
        self.assertEqual(await self.tick(BEFORE), 1)
        self.assertEqual(await self.tick(BEFORE), 0)
        await self.tick(DAY); await self.tick(DUE)
        _, feed = await self.request('GET', '/api/notifications')
        self.assertEqual(len(feed['items']), 3)
        self.assertEqual({row['kind'] for row in feed['items']}, {'task.before', 'task.day', 'task.overdue'})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 3)
        item = feed['items'][0]
        await self.request('PATCH', '/api/notifications/' + item['id'], payload={'read': True, 'dismissed': True})
        latest = (await self.request('GET', '/api/tasks/' + task['id']))[1]
        self.assertEqual(latest['version'], task['version']); self.assertFalse(latest['is_completed'])
        self.assertEqual((await self.request('GET', '/api/notifications', user='bob'))[1]['items'], [])
        self.assertEqual((await self.request('PATCH', '/api/notifications/' + item['id'], user='bob', payload={'read': True}))[0], 404)
        self.assertEqual((await self.request('GET', '/api/notifications', user=None))[0], 401)

    async def test_restart_catches_latest_stage_and_deadline_changes_invalidate_old_jobs(self):
        task = await self.task()
        await self.tick(DUE + timedelta(hours=2))
        _, feed = await self.request('GET', '/api/notifications')
        self.assertEqual([n['kind'] for n in feed['items']], ['task.overdue'])
        path = '/api/tasks/' + task['id']
        await self.request('PATCH', path, payload={'due_date': '2026-11-01'})
        self.assertEqual((await self.request('GET', '/api/notifications'))[1]['items'][0]['state'], 'changed')
        await self.request('PATCH', path, payload={'is_completed': True})
        self.assertEqual((await self.request('GET', '/api/notifications'))[1]['items'][0]['state'], 'completed')
        await self.request('DELETE', path)
        self.assertEqual((await self.request('GET', '/api/notifications'))[1]['items'][0]['state'], 'deleted')
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob)), 0)

    async def test_preview_does_not_resurrect_old_stages_after_read_or_hide(self):
        await self.task(); await self.tick(BEFORE); await self.tick(DAY)
        summary = (await self.request('GET', '/api/notifications/summary'))[1]
        self.assertEqual(len(summary['preview']), 1)
        latest = summary['preview'][0]
        self.assertEqual(latest['kind'], 'task.day')
        path = '/api/notifications/' + latest['id']
        await self.request('PATCH', path, payload={'read': True})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['preview'], [])
        await self.request('PATCH', path, payload={'read': False, 'dismissed': True})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['preview'], [])
        async with self.sessions() as db:
            db.add_all([Notification(user_id='alice', source='workflows', event_key='external-'+str(i), fingerprint='test', kind='external.info',
                title='Delivery '+str(i), resource_type='workflows.record', resource_id='same-record', occurred_at=DAY) for i in range(2)])
            await db.commit()
        preview = (await self.request('GET', '/api/notifications/summary'))[1]['preview']
        self.assertEqual(len(preview), 2)
        self.assertTrue(all(item['source'] == 'workflows' for item in preview))

    async def test_fresh_install_seeds_durable_jobs_once(self):
        from app.main import seed_initial_data
        with patch('app.main.async_session_maker', self.sessions):
            await seed_initial_data()
            async with self.sessions() as db:
                count = await db.scalar(select(func.count()).select_from(NotificationJob))
                self.assertGreater(count, 0)
                self.assertEqual(set((await db.scalars(select(NotificationJob.task_id))).all()),
                    set((await db.scalars(select(Task.id).where(Task.is_completed.is_(False)))).all()))
            await seed_initial_data()
            async with self.sessions() as db:
                self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob)), count)

    async def test_snooze_is_idempotent_and_does_not_change_task(self):
        task = await self.task(); await self.tick(BEFORE)
        item = (await self.request('GET', '/api/notifications'))[1]['items'][0]
        with patch('app.modules.notifications.router.utcnow', return_value=BEFORE):
            for _ in range(2): self.assertEqual((await self.request('POST', f"/api/notifications/{item['id']}/snooze"))[0], 204)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob).where(NotificationJob.kind == 'snooze')), 1)
        await self.tick(BEFORE + timedelta(hours=1))
        self.assertEqual(len((await self.request('GET', '/api/notifications'))[1]['items']), 2)
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id']))[1]['version'], 0)
        with patch('app.modules.notifications.router.utcnow', return_value=DUE):
            self.assertEqual((await self.request('POST', f"/api/notifications/{item['id']}/snooze"))[0], 409)

    async def test_cursor_feed_filters_and_read_all_cutoff(self):
        stamp = datetime(2026, 10, 10, tzinfo=UTC)
        async with self.sessions() as db:
            db.add_all([Notification(user_id='alice', source='workflows', event_key=str(i), fingerprint='x'*64, kind='external.info',
                title=f'Notice {i}', occurred_at=stamp, created_at=stamp) for i in range(61)])
            await db.commit()
        ids, cursor = [], None
        for _ in range(3):
            query = {'before': cursor} if cursor else {}
            code, page = await self.request('GET', '/api/notifications', query=query)
            self.assertEqual(code, 200); ids.extend(n['id'] for n in page['items']); cursor = page['next_cursor']
        self.assertEqual(len(ids), 61); self.assertEqual(len(set(ids)), 61)
        self.assertEqual((await self.request('GET', '/api/notifications', query={'before': 'bad cursor'}))[0], 422)
        await self.request('PATCH', '/api/notifications/' + ids[0], payload={'dismissed': True})
        self.assertEqual(len((await self.request('GET', '/api/notifications', query={'filter': 'hidden'}))[1]['items']), 1)
        await self.request('POST', '/api/notifications/read-all', payload={'through': (stamp - timedelta(seconds=1)).isoformat()})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 60)
        await self.request('POST', '/api/notifications/read-all', payload={'through': stamp.isoformat()})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 0)

    async def signed(self, source, payload, timestamp=None, signature_source=None):
        stamp = str(timestamp or int(time.time()))
        secret = 'integration-test-key-' + 'x'*32
        body = json.dumps(payload).encode()
        signature = 'sha256=' + hmac.new(secret.encode(), stamp.encode()+b'\n'+(signature_source or source).encode()+b'\n'+body, hashlib.sha256).hexdigest()
        with patch.object(settings, f'NOTIFICATIONS_{source.upper()}_SECRET', secret):
            return await self.request('POST', f'/api/integrations/{source}/notifications', user=None, payload=payload,
                headers_extra={'X-Notification-Timestamp': stamp, 'X-Notification-Signature': signature})

    async def test_enterprise_signature_isolation_idempotency_and_safe_paths(self):
        payload = {'external_id': 'approval:7:v1', 'recipient_user_id': 'alice', 'title': 'Please approve', 'action_path': '/approvals/7'}
        self.assertEqual((await self.request('POST', '/api/integrations/workflows/notifications', user=None, payload=payload))[0], 503)
        for source in ('bookingreports', 'workflows', 'itam'):
            code, notice = await self.signed(source, payload)
            self.assertEqual(code, 200)
            self.assertTrue((await self.signed(source, payload))[1]['duplicate'])
            self.assertEqual((await self.signed(source, {**payload, 'title': 'changed'}))[0], 409)
        self.assertEqual((await self.signed('workflows', payload, timestamp=int(time.time())-600))[0], 401)
        self.assertEqual((await self.signed('workflows', payload, signature_source='itam'))[0], 401)
        self.assertEqual((await self.signed('workflows', {**payload, 'external_id': 'unsafe', 'action_path': '//evil.example'}))[0], 422)
        self.assertEqual((await self.signed('workflows', {**payload, 'external_id': 'unsafe2', 'action_path': '/%252fexample.com'}))[0], 422)
        self.assertEqual((await self.signed('workflows', {**payload, 'recipient_user_id': 'missing'}))[0], 404)
        feed = (await self.request('GET', '/api/notifications'))[1]
        self.assertEqual(len(feed['items']), 3)
        self.assertNotIn('fingerprint', feed['items'][0])

    async def test_preferences_are_versioned_and_mute_future_deliveries(self):
        self.assertEqual((await self.request('PATCH', '/api/notifications/preferences', payload={'expected_version': 0, 'task_reminders': False, 'workflows': False}))[0], 200)
        self.assertEqual((await self.request('PATCH', '/api/notifications/preferences', payload={'expected_version': 0, 'task_reminders': True}))[0], 409)
        await self.task(); await self.tick(BEFORE)
        self.assertEqual((await self.request('GET', '/api/notifications'))[1]['items'], [])
        await self.signed('workflows', {'external_id': 'muted', 'recipient_user_id': 'alice', 'title': 'Muted message'})
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 0)
        self.assertEqual(len((await self.request('GET', '/api/notifications', query={'filter': 'hidden'}))[1]['items']), 1)

    async def test_migration_backfills_jobs_in_batches_without_duplicates(self):
        async with self.sessions() as db:
            db.add_all([Task(user_id='alice', title=f'Existing {i}', due_date='2026-12-20') for i in range(520)])
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_notifications(conn); await migrate_notifications(conn)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob)), 1560)

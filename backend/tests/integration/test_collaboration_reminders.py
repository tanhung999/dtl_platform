from datetime import timedelta
from unittest.mock import patch
from sqlalchemy import select
from tests.support.api_case import ApiTestCase
from tests.integration import test_user_reminders as reminders, test_delegation_followers as delegation
from app.db.models import User
from app.db.notifications import Notification, NotificationPreference
from app.db.access import UserRole
from app.db.workspace_versions import WorkspaceVersion
from app.modules.access.service import seed_catalog
from app.core.security import create_access_token

NOW, START = reminders.NOW, reminders.START


class CollaborationReminderTests(ApiTestCase):
    task = reminders.UserReminderTests.task
    event = reminders.UserReminderTests.event
    tick = reminders.UserReminderTests.tick
    grant_assignment = delegation.DelegationFollowerTests.grant_assignment

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.notifications.scheduling.utcnow', 'app.modules.tasks.router.utcnow'):
            clock = patch(name, return_value=NOW); clock.start(); self.addCleanup(clock.stop)
        async with self.sessions() as db:
            db.add(User(id='charlie', username='charlie', email='charlie@example.com', full_name='Charlie', password_hash='unused'))
            await db.commit()
        self.tokens['charlie'] = create_access_token({'sub': 'charlie'})

    async def feed(self, user):
        code, value = await self.request('GET', '/api/notifications', user=user)
        self.assertEqual(code, 200, value)
        return [item for item in value['items'] if item['kind'].endswith('reminder')]

    async def test_assignee_followers_receive_once_and_can_open(self):
        await self.grant_assignment()
        row = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        await self.tick(START - timedelta(minutes=15))
        for name in ('alice', 'bob', 'charlie'):
            notices = await self.feed(name); self.assertEqual(len(notices), 1)
            self.assertEqual((await self.request('GET', '/api/notifications/' + notices[0]['id'] + '/destination', user=name))[1], {'task_id': row['id']})
        self.assertEqual(await self.tick(START), 0)
        self.assertEqual(len(await self.feed('bob')), 1)

    async def test_personal_mute_does_not_mute_assigned_or_followed_items(self):
        await self.grant_assignment()
        async with self.sessions() as db:
            db.add_all([NotificationPreference(user_id=name, task_reminders=False) for name in ('alice', 'bob', 'charlie')]); await db.commit()
        await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        await self.tick(START)
        self.assertEqual(await self.feed('alice'), [])
        self.assertEqual(len(await self.feed('bob')), 1)
        self.assertEqual(len(await self.feed('charlie')), 1)

    async def test_private_event_explicit_follower_receives_and_revocation_hides(self):
        async with self.sessions() as db:
            await seed_catalog(db); db.add(UserRole(user_id='alice', role_id='calendar_sharer')); await db.commit()
        row = await self.event(follower_ids=['bob'], reminder_minutes=15, is_private=True)
        await self.tick(START)
        notices = await self.feed('bob'); self.assertEqual(len(notices), 1)
        notice = notices[0]
        self.assertEqual((await self.request('GET', '/api/notifications/' + notice['id'] + '/destination', user='bob'))[1], {'event_id': row['id']})
        self.assertEqual(await self.feed('charlie'), [])
        async with self.sessions() as db:
            before = await db.scalar(select(WorkspaceVersion.notifications).where(WorkspaceVersion.user_id == 'bob'))
        await self.request('POST', '/api/calendar/events/' + row['id'] + '/unfollow', user='bob')
        async with self.sessions() as db:
            after = await db.scalar(select(WorkspaceVersion.notifications).where(WorkspaceVersion.user_id == 'bob'))
            self.assertGreater(after, before)
        self.assertEqual(await self.feed('bob'), [])
        self.assertEqual((await self.request('GET', '/api/notifications/' + notice['id'] + '/destination', user='bob'))[0], 404)

    async def test_reassignment_and_removed_followers_use_current_membership(self):
        await self.grant_assignment()
        row = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        code, _ = await self.request('PATCH', '/api/tasks/' + row['id'], payload={'assignee_id': 'alice', 'follower_ids': []})
        self.assertEqual(code, 200)
        await self.tick(START)
        self.assertEqual(len(await self.feed('alice')), 1)
        self.assertEqual(await self.feed('bob'), [])
        self.assertEqual(await self.feed('charlie'), [])

    async def test_removed_task_follower_cannot_read_delivered_reminder(self):
        row = await self.task(follower_ids=['bob'], reminder_minutes=15)
        await self.tick(START)
        notice = (await self.feed('bob'))[0]
        await self.request('PATCH', '/api/tasks/' + row['id'], payload={'follower_ids': []})
        self.assertEqual(await self.feed('bob'), [])
        self.assertEqual((await self.request('PATCH', '/api/notifications/' + notice['id'], user='bob', payload={'read': True}))[0], 404)

    async def test_recurrence_notifies_each_occurrence_and_inactive_users_are_skipped(self):
        await self.event(follower_ids=['bob', 'charlie'], reminder_minutes=15, recurrence='DAILY')
        async with self.sessions() as db:
            (await db.get(User, 'charlie')).is_active = False; await db.commit()
        await self.tick(START - timedelta(minutes=15)); await self.tick(START + timedelta(days=1, minutes=-15))
        self.assertEqual(len(await self.feed('bob')), 2)
        async with self.sessions() as db:
            notices = (await db.scalars(select(Notification).where(Notification.user_id == 'charlie', Notification.kind == 'event.follow_reminder'))).all()
            self.assertEqual(notices, [])

    async def test_no_implicit_reminders_and_no_duplicate_for_calendar_viewer(self):
        async with self.sessions() as db:
            await seed_catalog(db); db.add(UserRole(user_id='alice', role_id='calendar_sharer')); await db.commit()
        code, _ = await self.request('PUT', '/api/calendar-sharing/mine/bob', payload={'expected_version': 0, 'share_tasks': True, 'share_events': True})
        self.assertEqual(code, 200)
        await self.task(follower_ids=['bob'])
        row = await self.event(follower_ids=['bob'], reminder_minutes=15)
        await self.tick(START)
        notices = await self.feed('bob'); self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]['resource_id'], row['id'])

    async def test_all_day_absolute_notification_sent_once_without_snooze(self):
        code, row = await self.request('POST', payload=self.event_payload(follower_ids=['bob'], is_all_day=True,
            starts_at='2026-10-20T00:00:00+07:00', ends_at='2026-10-23T00:00:00+07:00', reminder_at=START.isoformat()))
        self.assertEqual(code, 201, row)
        await self.tick(START); await self.tick(START + timedelta(days=1))
        notices = await self.feed('bob'); self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]['resource_id'], row['id'])
        self.assertEqual((await self.request('POST', '/api/notifications/' + notices[0]['id'] + '/snooze', user='bob'))[0], 409)

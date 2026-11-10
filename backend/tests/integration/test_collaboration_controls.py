"""Recipient isolation, direct-only sharing, completion notes and 500-person boundaries."""
from datetime import timedelta
from unittest.mock import patch
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support.api_case import ApiTestCase
from tests.integration import test_delegation_followers as delegation, test_user_reminders as reminders
from app.db.models import User
from app.db.access import UserRole, CalendarShare
from app.db.notifications import NotificationJob, Notification
from app.modules.access.service import seed_catalog
from app.core.security import create_access_token

NOW, START = reminders.NOW, reminders.START


class CollaborationControlsTests(ApiTestCase):
    task = reminders.UserReminderTests.task
    event = reminders.UserReminderTests.event
    tick = reminders.UserReminderTests.tick
    grant_assignment = delegation.DelegationFollowerTests.grant_assignment

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.notifications.scheduling.utcnow', 'app.modules.tasks.router.utcnow',
                     'app.modules.tasks.reminders.utcnow'):
            clock = patch(name, return_value=NOW); clock.start(); self.addCleanup(clock.stop)
        await self.grant_assignment()
        async with self.sessions() as db:
            db.add_all([User(id=name, username=name, email=f'{name}@example.invalid', full_name=name, position_id='test-pos', password_hash='unused')
                        for name in ('charlie', 'dana')])
            await seed_catalog(db)
            db.add_all([UserRole(user_id=name, role_id='calendar_sharer') for name in ('alice', 'bob', 'charlie')])
            await db.commit()
        self.tokens.update({name: create_access_token({'sub': name}) for name in ('charlie', 'dana')})

    async def feed(self, name):
        status, body = await self.request('GET', '/api/notifications', user=name)
        self.assertEqual(status, 200, body)
        return [row for row in body['items'] if row['kind'].endswith('reminder')]

    async def select_reminder(self, task, name='bob', **values):
        path = f"/api/tasks/{task['id']}/personal-reminder"
        status, current = await self.request('GET', path, user=name)
        self.assertEqual(status, 200, current)
        return await self.request('PUT', path, user=name, payload={
            'expected_version': current['version'], 'expected_task_version': current['task_version'], **values})

    async def share(self, owner, viewer, **flags):
        status, body = await self.request('PUT', '/api/calendar-sharing/mine/' + viewer, user=owner,
            payload={'expected_version': 0, 'share_events': True, 'share_tasks': True, 'share_notes': True, **flags})
        self.assertEqual(status, 200, body)

    async def test_assignee_inherits_then_receives_only_their_own_reminder(self):
        task = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        status, inherited = await self.request('GET', f"/api/tasks/{task['id']}/personal-reminder", user='bob')
        self.assertEqual(status, 200); self.assertEqual(inherited['reminder_minutes'], 15)
        self.assertFalse(inherited['has_override'])
        self.assertEqual((await self.select_reminder(task, reminder_minutes=30))[0], 200)
        creator = (await self.request('GET', '/api/tasks/' + task['id']))[1]
        self.assertEqual(creator['reminder_minutes'], 15)
        self.assertEqual(creator['version'], task['version'])
        await self.tick(START - timedelta(minutes=30))
        self.assertEqual(len(await self.feed('bob')), 1)
        self.assertEqual((await self.feed('bob'))[0]['kind'], 'task.personal_reminder')
        self.assertNotEqual((await self.feed('bob'))[0]['state'], 'changed')
        self.assertEqual(await self.feed('alice'), []); self.assertEqual(await self.feed('charlie'), [])
        await self.tick(START - timedelta(minutes=15))
        self.assertEqual(len(await self.feed('alice')), 1); self.assertEqual(len(await self.feed('charlie')), 1)
        self.assertEqual(len(await self.feed('bob')), 1)
        self.assertEqual(await self.tick(START), 0)

    async def test_no_reminder_override_suppresses_inheritance_even_with_direct_calendar_share(self):
        task = await self.task(assignee_id='bob', reminder_minutes=15)
        await self.share('alice', 'bob')
        self.assertEqual((await self.select_reminder(task, reminder_minutes=None, reminder_at=None))[0], 200)
        await self.tick(START)
        self.assertEqual(await self.feed('bob'), [])
        self.assertEqual(len(await self.feed('alice')), 1)

    async def test_owner_edits_do_not_reset_override_and_deadline_move_replans_it(self):
        task = await self.task(assignee_id='bob', reminder_minutes=15)
        self.assertEqual((await self.select_reminder(task, reminder_minutes=30))[0], 200)
        status, changed = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'reminder_minutes': 60})
        self.assertEqual(status, 200, changed)
        personal = (await self.request('GET', f"/api/tasks/{task['id']}/personal-reminder", user='bob'))[1]
        self.assertEqual(personal['reminder_minutes'], 30)
        status, changed = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'due_time': '10:00'})
        self.assertEqual(status, 200, changed)
        await self.tick(START + timedelta(minutes=30))
        self.assertEqual(len(await self.feed('bob')), 1)
        self.assertEqual(len(await self.feed('alice')), 1)

    async def test_only_current_assignee_can_change_personal_reminder_and_replay_is_safe(self):
        task = await self.task(assignee_id='bob', follower_ids=['charlie'])
        path = f"/api/tasks/{task['id']}/personal-reminder"
        for user in ('alice', 'charlie', 'dana'):
            self.assertIn((await self.request('GET', path, user=user))[0], (403, 404))
            status, _ = await self.request('PUT', path, user=user, payload={
                'reminder_minutes': 30, 'expected_version': 0, 'expected_task_version': task['version']})
            self.assertIn(status, (403, 404))
        body = {'reminder_minutes': 30, 'expected_version': 0, 'expected_task_version': task['version']}
        first = await self.request('PUT', path, user='bob', payload=body)
        second = await self.request('PUT', path, user='bob', payload=body)
        self.assertEqual(first[0], 200); self.assertEqual(second[1]['version'], first[1]['version'])
        status, _ = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'assignee_id': 'alice'})
        self.assertEqual(status, 200)
        self.assertEqual((await self.request('GET', path, user='bob'))[0], 404)
        await self.tick(START)
        self.assertEqual(await self.feed('bob'), [])

    async def test_personal_choice_cannot_block_owner_moving_or_clearing_deadline(self):
        task = await self.task(assignee_id='bob')
        code, body = await self.select_reminder(task, reminder_at=(START - timedelta(minutes=5)).isoformat())
        self.assertEqual(code, 200, body)
        code, moved = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'due_time': '08:00'})
        self.assertEqual(code, 200, moved)
        await self.tick(START)
        self.assertEqual(await self.feed('bob'), [])
        code, _ = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'due_date': None})
        self.assertEqual(code, 200)

    async def test_completion_note_permissions_bounds_and_reopening(self):
        task = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        path = '/api/tasks/' + task['id']
        status, _ = await self.request('PATCH', path, user='charlie', payload={'is_completed': True, 'completion_note': 'No'})
        self.assertEqual(status, 403)
        self.assertEqual((await self.request('PATCH', path, user='bob', payload={'is_completed': True, 'completion_note': 'x' * 501}))[0], 422)
        status, completed = await self.request('PATCH', path, user='bob', payload={'is_completed': True, 'completion_note': '  Đã hoàn thành  '})
        self.assertEqual(status, 200, completed)
        self.assertEqual(completed['completion_note'], 'Đã hoàn thành')
        self.assertEqual(completed['completed_by_id'], 'bob'); self.assertIsNotNone(completed['completed_at'])
        await self.tick(START)
        self.assertEqual(await self.feed('bob'), [])
        status, reopened = await self.request('PATCH', path, user='bob', payload={'is_completed': False})
        self.assertEqual(status, 200, reopened); self.assertIsNone(reopened['completion_note'])
        status, completed = await self.request('PATCH', path, user='bob', payload={'is_completed': True, 'completion_note': ''})
        self.assertEqual(status, 200, completed); self.assertIsNone(completed['completion_note'])

    async def test_owner_without_calendar_sharing_can_hide_indirect_items(self):
        async with self.sessions() as db:
            await db.execute(delete(UserRole).where(UserRole.user_id == 'alice', UserRole.role_id == 'calendar_sharer'))
            await db.commit()
        caps = (await self.request('GET', '/api/access/me'))[1]
        self.assertFalse(caps['can_share'])
        task = await self.task(assignee_id='bob', follower_ids=['charlie'], hide_from_indirect=True)
        event = await self.event(follower_ids=['bob'], hide_from_indirect=True)
        self.assertTrue(task['hide_from_indirect']); self.assertTrue(event['hide_from_indirect'])
        await self.share('bob', 'charlie')
        query = {'start': '2026-10-20T00:00:00+07:00', 'end': '2026-10-21T00:00:00+07:00'}
        self.assertEqual((await self.request('GET', '/api/calendar-sharing/view/bob', user='charlie', query=query))[1]['items'], [])
        for hidden in (False, True):
            code, changed_task = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'hide_from_indirect': hidden})
            self.assertEqual(code, 200, changed_task); self.assertEqual(changed_task['hide_from_indirect'], hidden)
            code, changed_event = await self.request('PUT', '/api/calendar/events/' + event['id'],
                payload=self.event_payload(starts_at=START.isoformat(), ends_at=(START+timedelta(hours=1)).isoformat(), hide_from_indirect=hidden))
            self.assertEqual(code, 200, changed_event); self.assertEqual(changed_event['hide_from_indirect'], hidden)
            items = (await self.request('GET', '/api/calendar-sharing/view/bob', user='charlie', query=query))[1]['items']
            self.assertEqual({item['id'] for item in items}, set() if hidden else {task['id'], event['id']})
        # Independent setting: the owner still cannot enable the SHARE-only private flag.
        self.assertEqual((await self.request('PATCH', '/api/tasks/' + task['id'], payload={'is_private': True}))[0], 403)
        self.assertEqual((await self.request('PUT', '/api/calendar/events/' + event['id'],
            payload=self.event_payload(is_private=True)))[0], 403)
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title':'Private denied','is_private':True}))[0], 403)
        self.assertEqual((await self.request('POST', payload=self.event_payload(is_private=True)))[0], 403)
        # Direct recipients and followers still cannot change their creator's setting.
        for user in ('bob', 'charlie'):
            self.assertEqual((await self.request('PATCH', '/api/tasks/' + task['id'], user=user, payload={'hide_from_indirect': False}))[0], 403)
        self.assertIn((await self.request('PUT', '/api/calendar/events/' + event['id'], user='bob', payload=self.event_payload(hide_from_indirect=False)))[0], (403,404))

    async def test_calendar_grants_never_chain_but_direct_collaborations_can_be_shared(self):
        await self.share('alice', 'bob'); await self.share('bob', 'charlie'); await self.share('charlie', 'dana')
        original = await self.event(title='Calendar-only original')
        followed = await self.event(title='Followed original', follower_ids=['bob'])
        hidden = await self.event(title='Hidden original', follower_ids=['bob'], hide_from_indirect=True)
        assigned = await self.task(title='Assigned original', assignee_id='bob')
        query = {'start': '2026-10-20T00:00:00+07:00', 'end': '2026-10-21T00:00:00+07:00'}
        code, page = await self.request('GET', '/api/calendar-sharing/view/bob', user='charlie', query=query)
        self.assertEqual(code, 200, page)
        ids = {row.get('series_id') or row['id'] for row in page['items']}
        self.assertIn(followed['id'], ids); self.assertIn(assigned['id'], ids)
        self.assertNotIn(original['id'], ids); self.assertNotIn(hidden['id'], ids)
        self.assertEqual((await self.request('GET', '/api/calendar-sharing/view/alice', user='charlie', query=query))[0], 404)
        self.assertEqual((await self.request('GET', f"/api/calendar-sharing/view/bob/event/{hidden['id']}", user='charlie'))[0], 404)
        self.assertEqual((await self.request('GET', '/api/calendar/events/' + hidden['id'], user='bob'))[0], 200)
        self.assertEqual((await self.request('GET', '/api/calendar-sharing/view/charlie', user='dana', query=query))[1]['items'], [])
        status, _ = await self.request('PATCH', '/api/tasks/' + assigned['id'], payload={'hide_from_indirect': True})
        self.assertEqual(status, 200)
        self.assertEqual((await self.request('GET', f"/api/calendar-sharing/view/bob/task/{assigned['id']}", user='charlie'))[0], 404)

    async def test_global_search_obeys_indirect_privacy_and_returns_the_actual_shared_calendar(self):
        await self.share('bob', 'charlie')
        task = await self.task(title='NeedleUnique assigned', assignee_id='bob')
        event = await self.event(title='NeedleUnique followed', follower_ids=['bob'])
        status, result = await self.request('GET', '/api/search', user='charlie', query={'q': 'NeedleUnique'})
        self.assertEqual(status, 200, result)
        for kind, item_id in (('tasks', task['id']), ('events', event['id'])):
            row = next(row for row in result['groups'][kind]['items'] if row['id'] == item_id)
            self.assertEqual(row['owner_id'], 'bob'); self.assertTrue(row['shared_only'])
        await self.request('PATCH', '/api/tasks/' + task['id'], payload={'hide_from_indirect': True})
        status, result = await self.request('GET', '/api/search', user='charlie', query={'q': 'NeedleUnique'})
        self.assertEqual(status, 200, result); self.assertEqual(result['groups']['tasks']['items'], [])

    async def test_500_boundaries_include_automatic_task_follower(self):
        ids = [f'person-{i:04d}' for i in range(501)]
        async with self.sessions() as db:
            db.add_all([User(id=name, username=name, email=f'{name}@example.invalid', full_name=name, position_id='test-pos', password_hash='unused') for name in ids])
            await db.commit()
        event = await self.event(follower_ids=ids[:500])
        self.assertEqual(len(event['followers']), 500)
        status, _ = await self.request('POST', payload=self.event_payload(follower_ids=ids))
        self.assertEqual(status, 422)
        task = await self.task(follower_ids=ids[:500])
        self.assertEqual(len(task['followers']), 500)
        task = await self.task(assignee_id='bob', follower_ids=ids[:499])
        self.assertEqual(len(task['followers']), 500)
        status, _ = await self.request('POST', '/api/tasks', payload={'title': 'Too many', 'assignee_id': 'bob', 'follower_ids': ids[:500]})
        self.assertEqual(status, 422)
        async with self.sessions() as db:
            db.add_all([CalendarShare(owner_id='alice', viewer_id=name) for name in ids[:500]])
            await db.commit()
        self.assertEqual((await self.request('GET', '/api/calendar-sharing/mine'))[0], 200)
        self.assertEqual(len((await self.request('GET', '/api/calendar-sharing/mine'))[1]), 500)
        status, _ = await self.request('PUT', '/api/calendar-sharing/mine/' + ids[500], payload={'expected_version': 0})
        self.assertEqual(status, 422)


class CollaborationMigrationTests(ApiTestCase):
    async def test_additive_migration_is_repeatable_and_preserves_old_privacy(self):
        from app.db.migrations.task_personal_reminders import migrate_task_personal_reminders
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                for ddl in ('CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)',
                            'CREATE TABLE tasks (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36), title TEXT)',
                            'CREATE TABLE calendar_events (id VARCHAR(36) PRIMARY KEY)',
                            'CREATE TABLE notification_jobs (id VARCHAR(36) PRIMARY KEY)'):
                    await conn.execute(text(ddl))
                await conn.execute(text("INSERT INTO users VALUES ('alice')"))
                await conn.execute(text("INSERT INTO tasks VALUES ('old', 'alice', 'Kept title')"))
                await conn.execute(text("INSERT INTO calendar_events VALUES ('event')"))
                await migrate_task_personal_reminders(conn)
                self.assertEqual((await conn.execute(text("SELECT title, hide_from_indirect FROM tasks WHERE id='old'"))).first(), ('Kept title', 1))
                await conn.execute(text("INSERT INTO tasks (id, user_id, title, hide_from_indirect) VALUES ('new', 'alice', 'New', FALSE)"))
                await migrate_task_personal_reminders(conn)
                self.assertEqual(await conn.scalar(text("SELECT hide_from_indirect FROM tasks WHERE id='new'")), 0)
                self.assertEqual(await conn.scalar(text("SELECT COUNT(*) FROM tasks")), 2)
        finally:
            await engine.dispose()

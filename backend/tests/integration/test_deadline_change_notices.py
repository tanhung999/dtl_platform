"""Deadline activity is recipient-specific and shares mutation idempotency."""
from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import select
from tests.integration import test_collaboration_controls as controls
from tests.support.api_case import ApiTestCase
from app.db.models import User
from app.modules.access.service import seed_catalog
from app.db.notifications import Notification, TaskReminderPreference, NotificationJob

NOW, START = controls.NOW, controls.START


class DeadlineChangeNoticeTests(ApiTestCase):
    task = controls.CollaborationControlsTests.task
    grant_assignment = controls.CollaborationControlsTests.grant_assignment
    select_reminder = controls.CollaborationControlsTests.select_reminder

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.tasks.service.utcnow', 'app.modules.tasks.router.utcnow',
                     'app.modules.tasks.reminders.utcnow', 'app.modules.notifications.scheduling.utcnow'):
            clock = patch(name, return_value=NOW)
            clock.start(); self.addCleanup(clock.stop)
        await self.grant_assignment()
        async with self.sessions() as db:
            db.add(User(id='charlie', username='charlie', email='charlie@example.invalid', full_name='Charlie', password_hash='unused'))
            await seed_catalog(db)
            await db.commit()

    async def changes(self, task_id):
        async with self.sessions() as db:
            return (await db.scalars(select(Notification).where(Notification.task_id == task_id, Notification.kind == 'task_deadline_changed'))).all()

    async def test_relative_override_recalculated_and_private_to_assignee(self):
        task = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        self.assertEqual((await self.select_reminder(task, reminder_minutes=30))[0], 200)
        code, saved = await self.request('PATCH', '/api/tasks/'+task['id'], payload={'expected_version':task['version'], 'due_date':'2026-10-21', 'due_time':'10:00'})
        self.assertEqual(code, 200, saved)
        notices = {row.user_id:row.body for row in await self.changes(task['id'])}
        self.assertEqual(set(notices), {'bob', 'charlie'})
        self.assertIn('21/10/2026 lúc 10:00', notices['bob'])
        self.assertIn('Thông báo riêng của bạn được tính lại', notices['bob'])
        self.assertIn('09:30 ngày 21/10/2026', notices['bob'])
        self.assertNotIn('Thông báo riêng', notices['charlie'])
        status, feed = await self.request('GET', '/api/notifications', user='bob')
        self.assertEqual(status, 200, feed)
        activity = [n for n in feed['items'] if n['kind'] == 'task_deadline_changed']
        self.assertEqual(len(activity), 1)
        self.assertEqual(activity[0]['state'], 'active')
        async with self.sessions() as db:
            self.assertEqual((await db.get(TaskReminderPreference, (task['id'], 'bob'))).reminder_minutes, 30)
        await self.request('PATCH', '/api/tasks/'+task['id'], payload={'expected_version':saved['version'], 'due_date':'2026-10-21', 'due_time':'10:00'})
        self.assertEqual(len(await self.changes(task['id'])), 2)

    async def test_invalid_absolute_reminder_reverts_to_creator_with_notice(self):
        task = await self.task(assignee_id='bob')
        stamp = START-timedelta(minutes=30)
        self.assertEqual((await self.select_reminder(task, reminder_at=stamp.isoformat()))[0], 200)
        code, saved = await self.request('PATCH', '/api/tasks/'+task['id'], payload={'expected_version':task['version'], 'due_date':'2026-10-19', 'due_time':'09:00'})
        self.assertEqual(code, 200, saved)
        notices = await self.changes(task['id'])
        self.assertEqual(len(notices), 1)
        self.assertIn('đã chuyển về theo thông báo của người tạo', notices[0].body)
        self.assertIn('Không nhắc', notices[0].body)
        async with self.sessions() as db:
            pref = await db.get(TaskReminderPreference, (task['id'], 'bob'))
            self.assertIsNone(pref)
            jobs = (await db.scalars(select(NotificationJob).where(NotificationJob.task_id==task['id'], NotificationJob.kind=='assignee', NotificationJob.processed_at.is_(None)))).all()
            self.assertEqual(jobs, [])

    async def test_fallback_receives_creator_reminder_only(self):
        from app.modules.notifications.worker import deliver_batch
        task = await self.task(assignee_id='bob', reminder_minutes=15)
        self.assertEqual((await self.select_reminder(task, reminder_at=(START-timedelta(minutes=30)).isoformat()))[0], 200)
        code, saved = await self.request('PATCH', '/api/tasks/'+task['id'], payload={'expected_version':task['version'], 'due_date':'2026-10-19'})
        self.assertEqual(code, 200, saved)
        path = '/api/tasks/'+task['id']+'/personal-reminder'
        _, selection = await self.request('GET', path, user='bob')
        self.assertFalse(selection['has_override'])
        self.assertEqual(selection['reminder_minutes'], 15)
        async with self.sessions() as db:
            await deliver_batch(db, now=START-timedelta(days=1, minutes=15)); await db.commit()
            await deliver_batch(db, now=START); await db.commit()
            reminders = (await db.scalars(select(Notification).where(Notification.task_id==task['id'], Notification.user_id=='bob', Notification.kind.in_(['task.follow_reminder','task.personal_reminder'])))).all()
            self.assertEqual(len(reminders), 1)
            self.assertEqual(reminders[0].kind, 'task.follow_reminder')

    async def test_unchanged_personal_reminder_does_not_create_override_or_bump_version(self):
        task = await self.task(assignee_id='bob', reminder_minutes=15)
        code, saved = await self.select_reminder(task, reminder_minutes=15)
        self.assertEqual(code, 200, saved)
        self.assertFalse(saved['has_override']); self.assertEqual(saved['version'], 0)
        code, saved = await self.select_reminder(task, reminder_minutes=30)
        self.assertEqual(code, 200, saved)
        version = saved['version']
        code, saved = await self.select_reminder(task, reminder_minutes=30)
        self.assertEqual(code, 200, saved); self.assertEqual(saved['version'], version)

    async def test_unchanged_task_keeps_versions_notifications_and_jobs(self):
        task = await self.task(assignee_id='bob', follower_ids=['charlie'], reminder_minutes=15)
        async with self.sessions() as db:
            before_jobs = [(r.id, r.event_key, r.scheduled_at) for r in (await db.scalars(select(NotificationJob))).all()]
            before_notices = set((await db.scalars(select(Notification.id))).all())
        code, saved = await self.request('PATCH', '/api/tasks/'+task['id'], payload={
            'expected_version':task['version'], 'title':task['title'], 'description':task['description'] or '',
            'due_date':task['due_date'], 'due_time':task['due_time'], 'assignee_id':'bob', 'follower_ids':['charlie'], 'reminder_minutes':15})
        self.assertEqual(code, 200, saved)
        for field in ('version','deadline_version','updated_at'): self.assertEqual(saved[field], task[field])
        async with self.sessions() as db:
            self.assertEqual([(r.id, r.event_key, r.scheduled_at) for r in (await db.scalars(select(NotificationJob))).all()], before_jobs)
            self.assertEqual(set((await db.scalars(select(Notification.id))).all()), before_notices)

    async def test_valid_absolute_kept_and_disabled_reminder_reported(self):
        for enabled in (True, False):
            task = await self.task(assignee_id='bob')
            values = {'reminder_at':(START-timedelta(minutes=30)).isoformat()} if enabled else {'reminder_minutes':None, 'reminder_at':None}
            self.assertEqual((await self.select_reminder(task, **values))[0], 200)
            code, saved = await self.request('PATCH', '/api/tasks/'+task['id'], payload={'expected_version':task['version'], 'due_time':'10:00'})
            self.assertEqual(code, 200, saved)
            notice = (await self.changes(task['id']))[0]
            self.assertIn('giữ nguyên lúc 08:30' if enabled else 'Không nhắc', notice.body)

    async def test_schedule_apply_retry_and_undo_produce_one_notice_per_change(self):
        task = await self.task(assignee_id='bob', reminder_minutes=15)
        path = '/api/schedule-changes/task/'+task['id']
        body = {'request_id':str(uuid4()), 'expected_version':task['version'], 'due_date':'2026-10-21', 'due_time':'10:00'}
        code, change = await self.request('POST', path, payload=body)
        self.assertEqual(code, 200, change)
        self.assertEqual((await self.request('POST', path, payload=body))[0], 200)
        self.assertEqual(len(await self.changes(task['id'])), 1)
        code, undo = await self.request('POST', '/api/schedule-changes/records/'+change['id']+'/undo')
        self.assertEqual(code, 200, undo)
        self.assertEqual(len(await self.changes(task['id'])), 2)
        self.assertEqual((await self.request('POST', '/api/schedule-changes/records/'+change['id']+'/undo'))[0], 200)
        self.assertEqual(len(await self.changes(task['id'])), 2)

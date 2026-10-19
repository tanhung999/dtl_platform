import unittest
from datetime import datetime
from unittest.mock import patch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support import api_case as test_calendar
from app.db.migrations.task_reminder_snooze import migrate_task_reminder_snooze
from app.modules.tasks.deadlines import VN


class ReminderSnoozeTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def test_snooze_across_stage_expiry_dismissal_and_deadline_change(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Nhắc lại', 'due_date': '2026-10-13'})
        base = '/api/tasks/' + task['id']
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 7, 45, tzinfo=VN)):
            status, _ = await self.request('POST', base + '/reminders/before/snooze', payload={'deadline_version': 0})
            self.assertEqual(status, 204)
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 8, tzinfo=VN)):
            _, reminders = await self.request('GET', '/api/tasks/reminders')
            self.assertEqual(reminders, [])
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 8, 45, tzinfo=VN)):
            _, reminders = await self.request('GET', '/api/tasks/reminders')
            self.assertEqual(reminders[0]['kind'], 'day')
            status, _ = await self.request('POST', base + '/reminders/day/snooze', payload={'deadline_version': 0})
            self.assertEqual(status, 204)
            status, _ = await self.request('POST', base + '/reminders/day/dismiss', payload={'deadline_version': 0})
            self.assertEqual(status, 204)
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 10, tzinfo=VN)):
            _, reminders = await self.request('GET', '/api/tasks/reminders')
            self.assertEqual(reminders, [])
            await self.request('PATCH', base, payload={'due_time': '12:00'})
            _, reminders = await self.request('GET', '/api/tasks/reminders')
            self.assertEqual(reminders[0]['deadline_version'], 1)
            status, _ = await self.request('POST', base + '/reminders/day/snooze', payload={'deadline_version': 0})
            self.assertEqual(status, 409)
            status, _ = await self.request('POST', base + '/reminders/day/snooze', user='bob', payload={'deadline_version': 1})
            self.assertEqual(status, 404)

    async def test_overdue_and_completed_cannot_be_snoozed(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Hạn giờ', 'due_date': '2026-10-13', 'due_time': '09:30'})
        base = '/api/tasks/' + task['id']
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 9, tzinfo=VN)):
            self.assertEqual((await self.request('POST', base + '/reminders/day/snooze', payload={'deadline_version': 0}))[0], 204)
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 10, tzinfo=VN)):
            self.assertEqual((await self.request('GET', '/api/tasks/reminders'))[1], [])
            self.assertEqual((await self.request('POST', base + '/reminders/day/snooze', payload={'deadline_version': 0}))[0], 409)
        await self.request('PATCH', base, payload={'is_completed': True})
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 13, 9, tzinfo=VN)):
            self.assertEqual((await self.request('POST', base + '/reminders/day/snooze', payload={'deadline_version': 0}))[0], 409)


class ReminderSnoozeMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_dismissal_preserved_and_idempotent(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE task_reminder_receipts (id TEXT PRIMARY KEY, dismissed_at DATETIME NOT NULL)'))
                await conn.execute(text("INSERT INTO task_reminder_receipts VALUES ('existing', '2026-10-12 09:00:00')"))
                await migrate_task_reminder_snooze(conn)
                await migrate_task_reminder_snooze(conn)
                row = (await conn.execute(text('SELECT * FROM task_reminder_receipts'))).mappings().one()
                self.assertEqual(row['id'], 'existing')
                self.assertEqual(row['dismissed_at'], '2026-10-12 09:00:00')
                self.assertIsNone(row['snoozed_until'])
        finally:
            await engine.dispose()

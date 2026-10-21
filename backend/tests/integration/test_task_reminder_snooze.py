import unittest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support import api_case as test_calendar
from app.db.migrations.retire_reminder_receipts import migrate_retire_reminder_receipts


class ReminderSnoozeTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def test_legacy_routes_do_not_recreate_automatic_reminders(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'No implicit reminder', 'due_date': '2026-10-13'})
        self.assertEqual((await self.request('GET', '/api/tasks/reminders'))[1], [])
        schedule = (await self.request('GET', '/api/tasks/reminders/schedule'))[1]
        self.assertEqual(schedule['items'], [])
        self.assertIsNone(schedule['next_check_at'])
        for action in ('snooze', 'dismiss'):
            self.assertEqual((await self.request('POST', f"/api/tasks/{task['id']}/reminders/day/{action}", payload={'deadline_version': 0}))[0], 410)


class ReminderSnoozeMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_retired_receipts_removed_idempotently(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE task_reminder_receipts (id TEXT PRIMARY KEY, dismissed_at DATETIME NOT NULL)'))
                await conn.execute(text("INSERT INTO task_reminder_receipts VALUES ('existing', '2026-10-12 09:00:00')"))
                await migrate_retire_reminder_receipts(conn)
                await migrate_retire_reminder_receipts(conn)
                self.assertIsNone(await conn.scalar(text("SELECT name FROM sqlite_master WHERE type='table' AND name='task_reminder_receipts'")))
        finally:
            await engine.dispose()

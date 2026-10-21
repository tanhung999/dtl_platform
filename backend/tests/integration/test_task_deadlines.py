import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import patch
from sqlalchemy import text, select
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support import api_case as test_calendar
from app.db.models import Task
from app.db.task_reminders import TaskReminderReceipt
from app.db.migrations.task_deadlines import migrate_task_deadlines
from app.modules.tasks.deadlines import deadline_at, VN
from app.core.realtime import stream


class TaskDeadlineApiTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def create(self, **values):
        status, task = await self.request('POST', '/api/tasks', payload={'title': 'Công việc', **values})
        self.assertEqual(status, 201)
        return task

    async def test_deadline_changes_completion_and_event_independence(self):
        task = await self.create()
        self.assertIsNone(task['due_date'])
        path = '/api/tasks/' + task['id']
        _, task = await self.request('PATCH', path, payload={'due_date': '2026-10-12', 'due_time': '09:00'})
        self.assertEqual((task['due_date'], task['due_time'], task['deadline_version']), ('2026-10-12', '09:00', 1))
        _, done = await self.request('PATCH', path, payload={'is_completed': True})
        self.assertTrue(done['is_completed'])
        self.assertEqual(done['due_date'], task['due_date'])
        self.assertEqual(done['deadline_version'], 1)
        _, task = await self.request('PATCH', path, payload={'due_date': '2026-10-13'})
        self.assertEqual(task['due_time'], '09:00')
        self.assertEqual(task['deadline_version'], 2)
        _, task = await self.request('PATCH', path, payload={'due_date': None})
        self.assertIsNone(task['due_date'])
        self.assertIsNone(task['due_time'])
        status, event = await self.request('POST', payload=test_calendar.ApiTestCase.event_payload(self))
        self.assertEqual(status, 201)
        await self.request('DELETE', path)
        _, events = await self.request('GET', query=test_calendar.ApiTestCase.range_query(self))
        self.assertEqual([e['id'] for e in events], [event['id']])

    async def test_validation_privacy_and_sorting(self):
        for payload in [{'title': ' '}, {'title': 'x', 'due_time': '9:00'}, {'title': 'x', 'due_date': 'Hôm nay'},
                        {'title': 'x', 'due_date': '2026-10-12', 'due_time': '24:00'}, {'title': 'x', 'priority': 'FAKE'}, {'title': 'x', 'user_id': 'bob'}]:
            status, _ = await self.request('POST', '/api/tasks', payload=payload)
            self.assertEqual(status, 422, payload)
        late = await self.create(title='late', due_date='2026-10-13', priority='URGENT')
        low = await self.create(title='low', due_date='2026-10-12', priority='LOW')
        high = await self.create(title='high', due_date='2026-10-12', priority='HIGH')
        undated = await self.create(title='undated', priority='URGENT')
        _, tasks = await self.request('GET', '/api/tasks')
        self.assertEqual([t['id'] for t in tasks], [high['id'], low['id'], late['id'], undated['id']])
        _, tasks = await self.request('GET', '/api/tasks', user='bob')
        self.assertEqual(tasks, [])
        for method in ['PATCH', 'DELETE']:
            status, _ = await self.request(method, '/api/tasks/' + high['id'], user='bob', payload={'is_completed': True} if method == 'PATCH' else None)
            self.assertEqual(status, 404)
        status, _ = await self.request('GET', '/api/tasks', user=None)
        self.assertEqual(status, 401)

    async def test_guarded_deadline_drop_and_undo(self):
        task = await self.create(due_date='2026-10-12', due_time='09:30')
        path = '/api/tasks/' + task['id']
        status, moved = await self.request('PATCH', path, payload={'due_date': '2026-10-15', 'due_time': task['due_time'], 'expected_deadline_version': task['deadline_version']})
        self.assertEqual(status, 200)
        self.assertEqual((moved['due_date'], moved['due_time']), ('2026-10-15', '09:30'))
        await self.request('PATCH', path, payload={'title': 'Tên đã sửa', 'is_completed': True})
        status, restored = await self.request('PATCH', path, payload={'due_date': task['due_date'], 'due_time': task['due_time'], 'expected_deadline_version': moved['deadline_version']})
        self.assertEqual(status, 200)
        self.assertEqual((restored['due_date'], restored['due_time']), ('2026-10-12', '09:30'))
        self.assertEqual(restored['title'], 'Tên đã sửa')
        self.assertTrue(restored['is_completed'])
        status, _ = await self.request('PATCH', path, payload={'due_date': '2026-10-15', 'expected_deadline_version': moved['deadline_version']})
        self.assertEqual(status, 409)
        _, tasks = await self.request('GET', '/api/tasks')
        self.assertEqual(tasks[0]['due_date'], '2026-10-12')
        undated = await self.create()
        path = '/api/tasks/' + undated['id']
        _, moved = await self.request('PATCH', path, payload={'due_date': '2026-10-15', 'expected_deadline_version': undated['deadline_version']})
        status, restored = await self.request('PATCH', path, payload={'due_date': None, 'due_time': None, 'expected_deadline_version': moved['deadline_version']})
        self.assertEqual(status, 200)
        self.assertIsNone(restored['due_date'])
        self.assertIsNone(restored['due_time'])

    async def test_time_only_defaults_to_vietnam_creation_date(self):
        created_at = datetime(2026, 10, 12, 17, 15, tzinfo=timezone.utc)
        with patch('app.modules.tasks.router.utcnow', return_value=created_at):
            task = await self.create(due_time='14:00')
            self.assertEqual((task['due_date'], task['due_time']), ('2026-10-13', '14:00'))
            self.assertEqual(datetime.fromisoformat(task['created_at'].replace('Z', '+00:00')), created_at)
            explicit = await self.create(due_date='2026-10-20', due_time='00:00')
            self.assertEqual(explicit['due_date'], '2026-10-20')
            undated = await self.create()
            self.assertIsNone(undated['due_date'])
        with patch('app.modules.tasks.router.utcnow', return_value=datetime(2026, 10, 20, tzinfo=timezone.utc)):
            status, edited = await self.request('PATCH', '/api/tasks/' + undated['id'], payload={'due_date': None, 'due_time': '12:00'})
            self.assertEqual(status, 200)
            self.assertEqual((edited['due_date'], edited['due_time'], edited['deadline_version']), ('2026-10-13', '12:00', 1))
            _, cleared = await self.request('PATCH', '/api/tasks/' + undated['id'], payload={'due_date': None, 'due_time': None})
            self.assertIsNone(cleared['due_date'])
            self.assertIsNone(cleared['due_time'])

    async def test_committed_realtime_updates_are_private(self):
        class Connected:
            async def is_disconnected(self): return False
        alice = stream('alice', Connected())
        bob = stream('bob', Connected())
        await anext(alice); await anext(bob)
        try:
            await self.create()
            update = await asyncio.wait_for(anext(alice), 1)
            self.assertIn('tasks', update)
            # Bob's queue remains empty; no information about Alice is delivered.
            from app.core.realtime import subscribers
            self.assertTrue(next(iter(subscribers['bob'])).empty())
        finally:
            await alice.aclose(); await bob.aclose()


class DeadlineRulesTests(unittest.TestCase):
    def test_vietnam_day_boundaries_and_early_time(self):
        task = Task(due_date='2026-10-13', is_completed=False)
        self.assertEqual(deadline_at(task), datetime(2026, 10, 14, tzinfo=VN))
        task.due_time = '07:00'
        self.assertEqual(deadline_at(task), datetime(2026, 10, 13, 7, tzinfo=VN))


class DeadlineMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_dates_preserved_and_migration_idempotent(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE tasks (id TEXT PRIMARY KEY, due_date TEXT, created_at TEXT)'))
                for id, label in [('today', 'Hôm nay'), ('tomorrow', 'Ngày mai'), ('week', 'Tuần này'), ('unknown', 'Khi rảnh'), ('iso', '2026-10-15')]:
                    await conn.execute(text('INSERT INTO tasks VALUES (:id, :due, :created)'), {'id': id, 'due': label, 'created': '2026-10-11T18:00:00+00:00'})
                await migrate_task_deadlines(conn)
                await migrate_task_deadlines(conn)
                rows = {r['id']: r for r in (await conn.execute(text('SELECT * FROM tasks'))).mappings()}
                self.assertEqual(rows['today']['due_date'], '2026-10-12')
                self.assertEqual(rows['tomorrow']['due_date'], '2026-10-13')
                self.assertEqual(rows['week']['due_date'], '2026-10-18')
                self.assertIsNone(rows['unknown']['due_date'])
                self.assertEqual(rows['unknown']['legacy_due_date'], 'Khi rảnh')
                self.assertEqual(rows['today']['legacy_due_date'], 'Hôm nay')
                self.assertEqual(rows['iso']['due_date'], '2026-10-15')
        finally:
            await engine.dispose()

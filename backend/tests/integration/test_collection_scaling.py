"""Revision conflicts, SQL pages, reconnect and reminder scheduling."""
import asyncio
import json
import unittest
from datetime import datetime
from unittest.mock import patch
from sqlalchemy import select
from tests.support import api_case as test_calendar
from app.db.models import Note
from app.core.realtime import stream, ALL_TOPICS
from app.modules.tasks.deadlines import VN

class CollectionScalingTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request
    event_payload = test_calendar.ApiTestCase.event_payload

    async def test_commit_finishes_before_success_is_sent(self):
        from app.core.database import get_db
        from app.main import app
        committed = []
        async def transaction():
            async with self.sessions() as db:
                yield db
                await db.commit()
                committed.append(True)
        app.dependency_overrides[get_db] = transaction
        real_app = test_calendar.app
        async def observed(scope, receive, send):
            async def checked(message):
                if message['type'] == 'http.response.start':
                    self.assertTrue(committed, 'A successful response must not precede commit')
                await send(message)
            await real_app(scope, receive, checked)
        with patch.object(test_calendar, 'app', observed):
            self.assertEqual((await self.request('POST', '/api/notes', payload={'title': 'Committed first'}))[0], 201)

    async def test_commit_failure_does_not_send_success(self):
        from app.core.database import get_db
        from app.main import app
        async def transaction():
            async with self.sessions() as db:
                try:
                    yield db
                    raise RuntimeError('Simulated commit failure')
                finally:
                    await db.rollback()
        app.dependency_overrides[get_db] = transaction
        statuses = []
        real_app = test_calendar.app
        async def observed(scope, receive, send):
            async def checked(message):
                if message['type'] == 'http.response.start': statuses.append(message['status'])
                await send(message)
            await real_app(scope, receive, checked)
        with patch.object(test_calendar, 'app', observed):
            with self.assertRaisesRegex(RuntimeError, 'Simulated commit failure'):
                await self.request('POST', '/api/notes', payload={'title': 'Must roll back'})
        self.assertEqual(statuses, [500])
        async with self.sessions() as db:
            self.assertEqual((await db.scalars(select(Note))).all(), [])

    async def test_task_revision_is_required_for_every_edit(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Original'})
        path = '/api/tasks/' + task['id']
        self.assertEqual((await self.request('PATCH', path, payload={'title': 'Missing'}, guard=False))[0], 422)
        status, changed = await self.request('PATCH', path, payload={'title': 'First writer', 'expected_version': task['version']})
        self.assertEqual(status, 200)
        self.assertEqual(changed['version'], 1)
        for payload in [{'title': 'Second writer'}, {'is_completed': True}, {'due_date': '2026-10-17'}]:
            self.assertEqual((await self.request('PATCH', path, payload={**payload, 'expected_version': task['version']}))[0], 409)
        _, latest = await self.request('GET', path)
        self.assertEqual(latest['title'], 'First writer')
        self.assertEqual(latest['deadline_version'], 0)
        self.assertEqual((await self.request('GET', path, user='bob'))[0], 404)

    async def test_event_form_checks_original_timestamp(self):
        _, event = await self.request('POST', payload=self.event_payload())
        path = '/api/calendar/events/' + event['id']
        self.assertEqual((await self.request('PUT', path, payload=self.event_payload(), guard=False))[0], 422)
        status, saved = await self.request('PUT', path, payload={**self.event_payload(title='First save'), 'expected_updated_at': event['updated_at']})
        self.assertEqual(status, 200)
        self.assertEqual((await self.request('PUT', path, payload={**self.event_payload(title='Stale'), 'expected_updated_at': event['updated_at']}))[0], 409)
        self.assertEqual((await self.request('GET', path))[1]['title'], 'First save')
        self.assertNotEqual(saved['updated_at'], event['updated_at'])

    async def test_task_pages_counts_and_calendar_are_independent(self):
        for i in range(31):
            await self.request('POST', '/api/tasks', payload={'title': str(i), 'due_date': '2026-10-13' if i < 27 else None, 'priority': 'HIGH' if i % 2 else 'LOW'})
        with patch('app.modules.tasks.collection.utcnow', return_value=datetime(2026, 10, 15, 9, tzinfo=VN)):
            _, page = await self.request('GET', '/api/tasks/collection')
            self.assertEqual(page['counts'], {'ALL': 31, 'PENDING': 31, 'DONE': 0, 'OVERDUE': 27})
            self.assertEqual(len(page['items']), 25)
            self.assertEqual(len(page['overdue']), 25)
            self.assertTrue(page['has_more'])
            _, more = await self.request('GET', '/api/tasks/collection', query={'offset': 25, 'overdue_offset': 25})
            self.assertEqual(len(more['items']), 6)
            self.assertEqual(len(more['overdue']), 2)
            self.assertFalse(set(t['id'] for t in page['items']) & set(t['id'] for t in more['items']))
        _, deadlines = await self.request('GET', '/api/tasks/calendar', query={'start': '2026-10-12', 'end': '2026-10-14'})
        self.assertEqual(len(deadlines), 27)
        self.assertEqual((await self.request('GET', '/api/tasks/calendar', user='bob', query={'start': '2026-10-12', 'end': '2026-10-14'}))[1], [])
        self.assertEqual((await self.request('GET', '/api/tasks/calendar', query={'start': '2026-01-01', 'end': '2027-01-01'}))[0], 422)

    async def test_page_sort_matches_true_deadline_at_midnight(self):
        _, all_day = await self.request('POST', '/api/tasks', payload={'title': 'All day low', 'due_date': '2026-10-13', 'priority': 'LOW'})
        _, midnight = await self.request('POST', '/api/tasks', payload={'title': 'Midnight urgent', 'due_date': '2026-10-14', 'due_time': '00:00', 'priority': 'URGENT'})
        _, page = await self.request('GET', '/api/tasks/collection', query={'limit': 1})
        self.assertEqual(page['items'][0]['id'], midnight['id'])
        _, page = await self.request('GET', '/api/tasks/collection', query={'limit': 1, 'offset': 1})
        self.assertEqual(page['items'][0]['id'], all_day['id'])




    async def test_reminder_next_check_snooze_and_early_deadline(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Early', 'due_date': '2026-10-13', 'due_time': '00:10'})
        endpoint = '/api/tasks/reminders/schedule'
        with patch('app.modules.tasks.collection.utcnow', return_value=datetime(2026, 10, 12, 7, 59, tzinfo=VN)):
            _, schedule = await self.request('GET', endpoint)
            self.assertEqual(schedule['items'], [])
            self.assertEqual(schedule['next_check_at'], '2026-10-12T01:00:00+00:00')
        with patch('app.modules.tasks.collection.utcnow', return_value=datetime(2026, 10, 12, 23, 40, tzinfo=VN)):
            _, schedule = await self.request('GET', endpoint)
            self.assertEqual(schedule['items'][0]['kind'], 'day')
            self.assertEqual(schedule['next_check_at'], '2026-10-12T17:00:00+00:00')
        _, normal = await self.request('POST', '/api/tasks', payload={'title': 'Morning', 'due_date': '2026-10-13', 'due_time': '12:00'})
        moment = datetime(2026, 10, 13, 9, tzinfo=VN)
        with patch('app.modules.tasks.router.utcnow', return_value=moment):
            await self.request('POST', f"/api/tasks/{normal['id']}/reminders/day/snooze", payload={'deadline_version': 0})
        with patch('app.modules.tasks.collection.utcnow', return_value=moment):
            _, schedule = await self.request('GET', endpoint)
            self.assertNotIn(normal['id'], [r['task_id'] for r in schedule['items']])
            self.assertEqual(schedule['next_check_at'], '2026-10-13T03:00:00+00:00')

    async def test_note_summary_schedules_only_its_next_real_transition(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'No periodic query'})
        _, page = await self.request('GET', '/api/notes/collection/page')
        self.assertIsNone(page['next_refresh_at'])
        _, scheduled = await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': note['version'], 'calendar_schedule': {'starts_at': '2099-10-13T09:00:00+07:00', 'ends_at': '2099-10-13T10:00:00+07:00', 'is_all_day': False}})
        event_id = scheduled['calendar_schedule']['event_id']
        _, page = await self.request('GET', '/api/notes/collection/page')
        self.assertEqual(datetime.fromisoformat(page['next_refresh_at']), datetime.fromisoformat(scheduled['calendar_schedule']['ends_at'].replace('Z', '+00:00')))
        await self.request('DELETE', '/api/calendar/events/' + event_id)
        _, page = await self.request('GET', '/api/notes/collection/page')
        self.assertIsNone(page['next_refresh_at'])

    async def test_reconnect_syncs_all_resources_and_heartbeat_has_no_query_topic(self):
        class Connected:
            async def is_disconnected(self): return False
        messages = stream('alice', Connected())
        try:
            first = await anext(messages)
            topics = json.loads(first.removeprefix('data: ').strip())['topics']
            self.assertEqual(set(topics), set(ALL_TOPICS))
            self.assertTrue({'notes'}.issubset(topics))
            async def timed_out(awaitable, timeout):
                awaitable.close()
                raise asyncio.TimeoutError()
            with patch('app.core.realtime.asyncio.wait_for', side_effect=timed_out):
                self.assertEqual(await anext(messages), ': heartbeat\n\n')
        finally:
            await messages.aclose()

"""Production bounds, creation receipts and guarded deletion of personal resources."""
import unittest
from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy import select
from tests.support import api_case as test_calendar
from app.db.models import Note, Task
from app.db.calendar import CalendarEvent
from app.db.create_requests import CreateRequest


class CollectionReliabilityTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request
    event_payload = test_calendar.ApiTestCase.event_payload
    range_query = test_calendar.ApiTestCase.range_query

    async def test_create_receipts_recover_retry_reject_changed_body_and_survive_delete(self):
        for base, data, kind in [('/api/tasks', {'title': 'One task', 'due_time': '16:00'}, 'task'),
                                 ('/api/calendar/events', self.event_payload(), 'event')]:
            payload = {**data, 'client_request_id': str(uuid4())}
            code, first = await self.request('POST', base, payload=payload)
            self.assertEqual(code, 201)
            self.assertEqual((await self.request('POST', base, payload=payload))[1]['id'], first['id'])
            self.assertEqual((await self.request('POST', base, payload={**payload, 'title': 'Changed'}))[0], 409)
            # The same UUID in a different account is a separate logical create.
            self.assertNotEqual((await self.request('POST', base, payload=payload, user='bob'))[1]['id'], first['id'])
            self.assertEqual((await self.request('DELETE', base + '/' + first['id']))[0], 204)
            self.assertEqual((await self.request('POST', base, payload=payload))[0], 410)
            async with self.sessions() as db:
                self.assertIsNotNone(await db.get(CreateRequest, ('alice', kind, payload['client_request_id'])))

    async def test_deletes_require_snapshot_and_reject_later_edits(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Original'})
        path = '/api/tasks/' + task['id']
        self.assertEqual((await self.request('DELETE', path, guard=False))[0], 422)
        await self.request('PATCH', path, payload={'title': 'New'})
        code, error = await self.request('DELETE', path, query={'expected_version': 0}, guard=False)
        self.assertEqual(code, 409)
        self.assertEqual(error['detail']['current']['title'], 'New')
        self.assertEqual((await self.request('GET', path))[0], 200)
        self.assertEqual((await self.request('DELETE', path, query={'expected_version': 1}, guard=False))[0], 204)
        self.assertEqual((await self.request('DELETE', path, query={'expected_version': 1}, guard=False))[0], 404)
        _, item = await self.request('POST', payload=self.event_payload())
        path = '/api/calendar/events/' + item['id']
        await self.request('PUT', path, payload=self.event_payload(title='Changed'))
        code, error = await self.request('DELETE', path, query={'expected_updated_at': item['updated_at']}, guard=False)
        self.assertEqual(code, 409)
        self.assertEqual(error['detail']['current']['title'], 'Changed')
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Note snapshot'})
        path = '/api/notes/' + note['id']
        self.assertEqual((await self.request('DELETE', path, guard=False))[0], 422)
        await self.request('PATCH', path, payload={'title': 'New note', 'expected_version': note['version']})
        self.assertEqual((await self.request('DELETE', path, payload={'expected_version': note['version']}, guard=False))[0], 409)
        self.assertEqual((await self.request('DELETE', path, payload={'expected_version': note['version'] + 1}, guard=False))[0], 204)

    async def test_calendar_caps_payload_and_day_counts_include_hidden_rows(self):
        async with self.sessions() as db:
            db.add_all([CalendarEvent(user_id='alice', title=f'E {i}', description='private full body',
                starts_at=datetime(2026, 10, 12, 2, tzinfo=timezone.utc), ends_at=datetime(2026, 10, 12, 3, tzinfo=timezone.utc)) for i in range(502)])
            db.add_all([Task(user_id='alice', title=f'T {i}', due_date='2026-10-12', description='full task body') for i in range(502)])
            await db.commit()
        code, result = await self.request('GET', '/api/calendar/events/collection', query=self.range_query())
        self.assertEqual(code, 200)
        self.assertEqual((len(result['items']), result['total'], result['truncated']), (500, 502, True))
        self.assertEqual(result['items'][0]['description'], '')
        _, tasks = await self.request('GET', '/api/tasks/calendar/page', query={'start': '2026-10-12', 'end': '2026-10-13'})
        self.assertEqual((len(tasks['items']), tasks['total'], tasks['truncated']), (500, 502, True))
        self.assertIsNone(tasks['items'][0]['description'])
        code, days = await self.request('GET', '/api/calendar/days', query={'start': '2026-10-12', 'end': '2026-10-14'})
        self.assertEqual(code, 200)
        self.assertEqual((days['2026-10-12']['events'], days['2026-10-12']['tasks']), (502, 502))
        self.assertEqual(days['2026-10-13']['events'], 0)
        _, private = await self.request('GET', '/api/calendar/days', query={'start': '2026-10-12', 'end': '2026-10-14'}, user='bob')
        self.assertEqual(private['2026-10-12']['events'], 0)

    async def test_notes_widget_caps_pins_without_discarding_them_and_short_search_is_bounded(self):
        async with self.sessions() as db:
            db.add_all([Note(user_id='alice', title=f'Pinned {i}', is_pinned=True, sort_order=i) for i in range(14)])
            db.add_all([Note(user_id='alice', title=f'Other {i}', sort_order=14+i) for i in range(8)])
            await db.commit()
        _, widget = await self.request('GET', '/api/notes/collection/page', query={'widget': 'true'})
        self.assertEqual(len(widget['items']), 12)
        self.assertEqual(widget['pinned_total'], 14)
        self.assertEqual(widget['hidden'], 10)
        _, page = await self.request('GET', '/api/notes/collection/page', query={'filter': 'pinned'})
        self.assertEqual(page['total'], 14)
        _, page = await self.request('GET', '/api/notes/collection/page', query={'q': 'p'})
        self.assertEqual(page['items'], [])

    async def test_task_cursor_matches_full_sort_including_null_dates_and_midnight_ties(self):
        async with self.sessions() as db:
            db.add_all([Task(id=f'seek-{i:02d}', user_id='alice', title=str(i),
                due_date=None if i % 4 == 0 else ('2026-10-12' if i % 3 == 0 else '2026-10-13'),
                due_time='00:00' if i % 4 == 1 else None, priority=['URGENT', 'HIGH', 'MEDIUM', 'LOW'][i % 4],
                is_completed=i % 7 == 0) for i in range(37)])
            await db.commit()
        _, full = await self.request('GET', '/api/tasks', query={'limit': 100})
        collected, cursor = [], None
        for offset in range(0, 37, 5):
            query = {'offset': offset, 'limit': 5}
            if cursor: query['after'] = cursor
            status, page = await self.request('GET', '/api/tasks/collection', query=query)
            self.assertEqual(status, 200)
            collected += [row['id'] for row in page['items']]
            cursor = page['next_cursor']
        self.assertEqual(collected, [row['id'] for row in full])
        _, first = await self.request('GET', '/api/tasks/collection', query={'limit': 5})
        anchor = first['items'][-1]
        await self.request('PATCH', '/api/tasks/' + anchor['id'], payload={'title': 'Anchor changed'})
        self.assertEqual((await self.request('GET', '/api/tasks/collection', query={'offset': 5, 'limit': 5, 'after': first['next_cursor']}))[0], 409)

    async def test_moving_note_to_head_does_not_rewrite_neighbors(self):
        async with self.sessions() as db:
            db.add_all([Note(id=f'rank-{i:03d}', user_id='alice', title=str(i), sort_order=i) for i in range(100)])
            db.add(Note(id='rank-pinned', user_id='alice', title='Pinned', is_pinned=True, sort_order=-1))
            await db.commit()
        status, _ = await self.request('POST', '/api/notes/rank-099/move', payload={'expected_version': 0, 'placement': 'start'})
        self.assertEqual(status, 200)
        async with self.sessions() as db:
            rows = (await db.execute(select(Note.id, Note.sort_order).where(Note.user_id == 'alice'))).all()
            ranks = dict(rows)
            self.assertLess(ranks['rank-099'], 0)
            self.assertEqual(ranks['rank-pinned'], -1)
            self.assertEqual([ranks[f'rank-{i:03d}'] for i in range(99)], list(range(99)))

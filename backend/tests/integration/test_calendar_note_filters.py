"""Bộ lọc trước LIMIT, số đếm độc lập và các lỗi phát hiện khi rà soát."""
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from tests.support.api_case import ApiTestCase

VN = timezone(timedelta(hours=7))

class CalendarNoteFilterTests(ApiTestCase):
    def schedule(self):
        return {'starts_at': '2026-10-16T09:00:00+07:00', 'ends_at': '2026-10-16T09:30:00+07:00', 'is_all_day': False}

    async def test_filters_before_limit_and_counts_are_independent(self):
        for i in range(2):
            await self.request('POST', '/api/notes', payload={'title': str(i), 'calendar_schedule': self.schedule()})
        _, event = await self.request('POST', payload=self.event_payload(starts_at='2026-10-16T10:00:00+07:00', ends_at='2026-10-16T11:00:00+07:00'))
        query = {'start': '2026-10-16T00:00:00+07:00', 'end': '2026-10-17T00:00:00+07:00', 'limit': 1}
        for events, notes, total in [(True, True, 3), (True, False, 1), (False, True, 2), (False, False, 0)]:
            status, data = await self.request('GET', '/api/calendar/events/collection', query={**query, 'include_events': str(events).lower(), 'include_notes': str(notes).lower()})
            self.assertEqual(status, 200, data)
            self.assertEqual((data['event_total'], data['note_total'], data['total']), (1, 2, total))
            self.assertEqual(data['truncated'], total > 1)
            self.assertEqual(len(data['items']), min(total, 1))
            if events and not notes:
                self.assertEqual(data['items'][0]['id'], event['id'])
            if notes and not events:
                self.assertTrue(data['items'][0]['scheduled_note_id'])
        _, private = await self.request('GET', '/api/calendar/events/collection', query=query, user='bob')
        self.assertEqual((private['event_total'], private['note_total']), (0, 0))
        _, days = await self.request('GET', '/api/calendar/days', query={'start': '2026-10-16', 'end': '2026-10-17'})
        self.assertEqual((days['2026-10-16']['events'], days['2026-10-16']['notes']), (1, 2))

    async def test_task_counts_schedule_refresh_at_deadline_without_minute_polling(self):
        await self.request('POST', '/api/tasks', payload={'title': 'Có giờ', 'due_date': '2026-10-16', 'due_time': '09:01'})
        await self.request('POST', '/api/tasks', payload={'title': 'Cả ngày', 'due_date': '2026-10-16'})
        with patch('app.modules.tasks.collection.utcnow', return_value=datetime(2026, 10, 16, 9, 0, tzinfo=VN)):
            _, page = await self.request('GET', '/api/tasks/collection')
            self.assertEqual(datetime.fromisoformat(page['next_refresh_at']), datetime(2026, 10, 16, 9, 1, tzinfo=VN))
            self.assertEqual(page['counts']['OVERDUE'], 0)
        with patch('app.modules.tasks.collection.utcnow', return_value=datetime(2026, 10, 16, 9, 1, tzinfo=VN)):
            _, page = await self.request('GET', '/api/tasks/collection')
            self.assertEqual(page['counts']['OVERDUE'], 1)
            self.assertEqual(datetime.fromisoformat(page['next_refresh_at']), datetime(2026, 10, 17, 0, 0, tzinfo=VN))
        _, empty = await self.request('GET', '/api/tasks/collection', user='bob')
        self.assertIsNone(empty['next_refresh_at'])

    async def test_archive_saves_schedule_and_conflict_rolls_back_archive(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Ghi chú'})
        status, archived = await self.request('PATCH', f'/api/notes/{note["id"]}', payload={'expected_version': note['version'], 'title': 'Đã lưu', 'is_archived': True, 'calendar_schedule': self.schedule()})
        self.assertEqual(status, 200, archived)
        self.assertTrue(archived['is_archived'])
        self.assertTrue(archived['calendar_schedule'])
        _, normal = await self.request('POST', '/api/notes', payload={'title': 'Giữ nguyên', 'calendar_schedule': self.schedule()})
        event_id = normal['calendar_schedule']['event_id']
        await self.request('PUT', f'/api/calendar/events/{event_id}', payload=self.event_payload())
        status, _ = await self.request('PATCH', f'/api/notes/{normal["id"]}', payload={'expected_version': normal['version'], 'title': 'Không lưu', 'is_archived': True, 'calendar_schedule': normal['calendar_schedule']})
        self.assertEqual(status, 409)
        _, latest = await self.request('GET', f'/api/notes/{normal["id"]}')
        self.assertFalse(latest['is_archived'])
        self.assertEqual(latest['title'], 'Giữ nguyên')

import unittest
from tests.support import api_case as test_calendar


class EventScheduleTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request
    event_payload = test_calendar.ApiTestCase.event_payload

    async def test_schedule_preserves_details_and_rejects_stale_edits(self):
        _, event = await self.request('POST', payload=self.event_payload())
        path = '/api/calendar/events/' + event['id'] + '/schedule'
        payload = {'starts_at': '2026-10-15T10:15:00+07:00', 'ends_at': '2026-10-15T11:30:00+07:00', 'is_all_day': False, 'expected_updated_at': event['updated_at']}
        status, moved = await self.request('PATCH', path, payload=payload)
        self.assertEqual(status, 200)
        self.assertEqual(moved['title'], event['title'])
        self.assertEqual(moved['description'], event['description'])
        status, _ = await self.request('PATCH', path, payload=payload)
        self.assertEqual(status, 409)
        payload['expected_updated_at'] = moved['updated_at']
        status, _ = await self.request('PATCH', path, user='bob', payload=payload)
        self.assertEqual(status, 404)
        for changes in [{'ends_at': '2026-10-14T10:00:00+07:00'}, {'is_all_day': True}]:
            status, _ = await self.request('PATCH', path, payload={**payload, **changes})
            self.assertEqual(status, 422)
        status, all_day = await self.request('PATCH', path, payload={**payload, 'is_all_day': True, 'starts_at': '2026-10-15T00:00:00+07:00', 'ends_at': '2026-10-19T00:00:00+07:00'})
        self.assertEqual(status, 200); self.assertTrue(all_day['is_all_day'])

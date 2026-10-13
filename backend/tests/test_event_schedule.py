import unittest
import test_calendar


class EventScheduleTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.CalendarApiTests.asyncSetUp
    asyncTearDown = test_calendar.CalendarApiTests.asyncTearDown
    request = test_calendar.CalendarApiTests.request
    event_payload = test_calendar.CalendarApiTests.event_payload

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

"""API timestamps stay explicit UTC after a SQLite round-trip on another server."""
from datetime import datetime, timezone
from tests.support.api_case import ApiTestCase
from app.db.models import Note

class CalendarTimezoneContractTests(ApiTestCase):
    async def create_scheduled_note(self):
        status, note = await self.request('POST', '/api/notes', payload={
            'title': 'Ngày 22 đến hết 25',
            'calendar_schedule': {'starts_at': '2026-10-22T00:00:00+07:00',
                'ends_at': '2026-10-26T00:00:00+07:00', 'is_all_day': True}})
        self.assertEqual(status, 201, note)
        return note

    def assert_instant(self, value, expected):
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        self.assertIsNotNone(parsed.tzinfo, f'API returned an ambiguous timestamp: {value}')
        self.assertEqual(parsed.astimezone(timezone.utc), datetime.fromisoformat(expected))

    async def test_all_day_calendar_collection_preserves_vietnam_start_and_inclusive_end(self):
        note = await self.create_scheduled_note()
        _, collection = await self.request('GET', '/api/calendar/events/collection', query={
            'start': '2026-10-19T00:00:00+07:00', 'end': '2026-10-27T00:00:00+07:00'})
        event = next(row for row in collection['items'] if row['scheduled_note_id'] == note['id'])
        self.assert_instant(event['starts_at'], '2026-10-21T17:00:00+00:00')
        self.assert_instant(event['ends_at'], '2026-10-25T17:00:00+00:00')
        for name in ('created_at', 'updated_at'):
            self.assertIsNotNone(datetime.fromisoformat(event[name].replace('Z', '+00:00')).tzinfo)
        # The API must treat explicit Vietnam bounds exactly like their UTC equivalents.
        # SQLite otherwise discards the +07:00 offset while binding the query.
        for query in (
            {'start': '2026-10-21T00:00:00+07:00', 'end': '2026-10-22T00:00:00+07:00'},
            {'start': '2026-10-20T17:00:00Z', 'end': '2026-10-21T17:00:00Z'},
        ):
            _, previous_day = await self.request('GET', '/api/calendar/events/collection', query=query)
            self.assertEqual(previous_day['items'], [])

    async def test_note_detail_and_legacy_list_return_creation_instant_with_timezone(self):
        note = await self.create_scheduled_note()
        async with self.sessions() as db:
            row = await db.get(Note, note['id'])
            # 01:00 Vietnam on 22/10, a time where losing UTC produces the previous day.
            row.created_at = datetime(2026, 10, 21, 18, tzinfo=timezone.utc)
            await db.commit()
        for path in ('/api/notes/' + note['id'], '/api/notes'):
            status, value = await self.request('GET', path)
            self.assertEqual(status, 200)
            row = value[0] if isinstance(value, list) else value
            self.assert_instant(row['created_at'], '2026-10-21T18:00:00+00:00')

    async def test_shared_note_grid_and_detail_keep_timezone_after_database_read(self):
        note = await self.create_scheduled_note()
        from app.modules.access.service import seed_catalog
        from app.db.access import UserRole, CalendarShare
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='calendar_sharer'))
            db.add(CalendarShare(owner_id='alice', viewer_id='bob', share_events=True, share_notes=True))
            await db.commit()
        status, value = await self.request('GET', '/api/calendar-sharing/view/alice', user='bob', query={
            'start': '2026-10-19T00:00:00+07:00', 'end': '2026-10-27T00:00:00+07:00'})
        self.assertEqual(status, 200, value)
        self.assert_instant(value['items'][0]['starts_at'], '2026-10-21T17:00:00+00:00')
        status, detail = await self.request('GET', '/api/calendar-sharing/view/alice/note/' + note['calendar_schedule']['event_id'], user='bob')
        self.assertEqual(status, 200, detail)
        self.assert_instant(detail['starts_at'], '2026-10-21T17:00:00+00:00')
        self.assert_instant(detail['ends_at'], '2026-10-25T17:00:00+00:00')
        _, previous_day = await self.request('GET', '/api/calendar-sharing/view/alice', user='bob', query={
            'start': '2026-10-21T00:00:00+07:00', 'end': '2026-10-22T00:00:00+07:00'})
        self.assertEqual(previous_day['items'], [])

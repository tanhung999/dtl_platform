"""Lịch hẹn ghi chú: phiên bản, nhận diện loại mục và quyền sở hữu."""
from uuid import uuid4
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.models import Note
from app.db.calendar import CalendarEvent

class NoteSchedulingTests(ApiTestCase):
    def schedule(self, **overrides):
        return {"starts_at": "2026-10-16T09:00:00+07:00", "ends_at": "2026-10-16T09:30:00+07:00", "is_all_day": False, **overrides}

    async def test_note_schedule_creation_retry_update_and_stale_event(self):
        payload = {"title": "Lịch hẹn", "request_id": str(uuid4()), "calendar_schedule": self.schedule()}
        status, note = await self.request("POST", "/api/notes", payload=payload)
        self.assertEqual(status, 201, note)
        appointment = note['calendar_schedule']
        self.assertTrue(appointment['event_id'])
        _, retry = await self.request("POST", "/api/notes", payload=payload)
        self.assertEqual(retry['id'], note['id'])
        _, full = await self.request("GET", f"/api/notes/{note['id']}")
        self.assertEqual(full['calendar_schedule'], appointment)
        changed = {**appointment, **self.schedule(starts_at="2026-10-17T00:00:00+07:00", ends_at="2026-10-18T00:00:00+07:00", is_all_day=True)}
        status, updated = await self.request("PATCH", f"/api/notes/{note['id']}", payload={"expected_version": note['version'], "calendar_schedule": changed})
        self.assertEqual(status, 200, updated)
        self.assertEqual(updated['calendar_schedule']['event_id'], appointment['event_id'])
        self.assertTrue(updated['calendar_schedule']['is_all_day'])
        _, event = await self.request("GET", f"/api/calendar/events/{appointment['event_id']}")
        await self.request("PUT", f"/api/calendar/events/{event['id']}", payload=self.event_payload(title="Đã dời"))
        status, _ = await self.request("PATCH", f"/api/notes/{note['id']}", payload={"expected_version": updated['version'], "title": "Không được ghi đè", "calendar_schedule": updated['calendar_schedule']})
        self.assertEqual(status, 409)
        _, latest = await self.request("GET", f"/api/notes/{note['id']}")
        self.assertEqual(latest['title'], 'Lịch hẹn')
        self.assertEqual(latest['version'], updated['version'])
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarEvent)), 1)

    async def test_deletions_keep_independent_resources(self):
        _, note = await self.request("POST", "/api/notes", payload={"title": "Note", "calendar_schedule": self.schedule()})
        await self.request("DELETE", f"/api/calendar/events/{note['calendar_schedule']['event_id']}")
        _, full = await self.request("GET", f"/api/notes/{note['id']}")
        self.assertIsNone(full['calendar_schedule'])
        status, _ = await self.request("PATCH", f"/api/notes/{note['id']}", payload={"expected_version": full['version'], "calendar_schedule": note['calendar_schedule']})
        self.assertEqual(status, 409)
        _, second = await self.request("POST", "/api/notes", payload={"title": "Note 2", "calendar_schedule": self.schedule()})
        await self.request("DELETE", f"/api/notes/{second['id']}")
        status, _ = await self.request("GET", f"/api/calendar/events/{second['calendar_schedule']['event_id']}")
        self.assertEqual(status, 200)

    async def test_schedule_collection_metadata_and_removed_link_endpoints(self):
        _, note = await self.request("POST", "/api/notes", payload={"title": "Có lịch", "calendar_schedule": self.schedule()})
        event_id = note['calendar_schedule']['event_id']
        _, page = await self.request("GET", "/api/notes/collection/page", query={"filter": "scheduled"})
        self.assertTrue(page['has_scheduled'])
        self.assertEqual(page['items'][0]['scheduled_event']['id'], event_id)
        self.assertNotIn('linked_event', page['items'][0])
        _, info = await self.request("GET", f"/api/notes/{note['id']}/delete-info")
        self.assertTrue(info['has_calendar_schedule'])
        for method, path, payload in [
            ('POST', f'/api/notes/{note["id"]}/events', {'event_ids': [event_id]}),
            ('POST', f'/api/calendar/events/{event_id}/notes', {'note_ids': [note['id']]}),
            ('GET', f'/api/calendar/events/{event_id}/notes', None),
            ('GET', '/api/notes/events-summary', None),
        ]:
            status, _ = await self.request(method, path, payload=payload)
            self.assertIn(status, (404, 405))
        status, _ = await self.request('POST', payload=self.event_payload(note_ids=[note['id']]))
        self.assertEqual(status, 422)
        _, event = await self.request('GET', f'/api/calendar/events/{event_id}')
        self.assertNotIn('note_count', event)

    async def test_schedule_requires_valid_range_and_owner(self):
        status, _ = await self.request("POST", "/api/notes", payload={"calendar_schedule": self.schedule(ends_at="2026-10-16T08:00:00+07:00")})
        self.assertEqual(status, 422)
        _, note = await self.request("POST", "/api/notes", user="bob", payload={"title": "Riêng", "calendar_schedule": self.schedule()})
        status, _ = await self.request("PATCH", f"/api/notes/{note['id']}", payload={"expected_version": note['version'], "calendar_schedule": note['calendar_schedule']})
        self.assertEqual(status, 404)

    async def test_calendar_note_identity_and_title_update(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Ghi chú', 'color': '#fbcfe8', 'calendar_schedule': self.schedule()})
        event_id = note['calendar_schedule']['event_id']
        _, event = await self.request('GET', f'/api/calendar/events/{event_id}')
        self.assertEqual(event['scheduled_note_id'], note['id'])
        _, ordinary = await self.request('POST', payload=self.event_payload())
        self.assertIsNone(ordinary['scheduled_note_id'])
        _, collection = await self.request('GET', '/api/calendar/events/collection', query={'start': '2026-10-16T00:00:00+07:00', 'end': '2026-10-17T00:00:00+07:00'})
        self.assertEqual(collection['items'][0]['scheduled_note_id'], note['id'])
        self.assertNotIn('content', collection['items'][0])
        self.assertEqual((await self.request('GET', f'/api/calendar/events/{event_id}', user='bob'))[0], 404)
        status, updated = await self.request('PATCH', f'/api/notes/{note["id"]}', payload={'expected_version': note['version'], 'title': 'Tiêu đề mới', 'calendar_schedule': note['calendar_schedule']})
        self.assertEqual(status, 200, updated)
        self.assertEqual((await self.request('GET', f'/api/calendar/events/{event_id}'))[1]['title'], 'Tiêu đề mới')
        await self.request('DELETE', f'/api/notes/{note["id"]}')
        self.assertIsNone((await self.request('GET', f'/api/calendar/events/{event_id}'))[1]['scheduled_note_id'])

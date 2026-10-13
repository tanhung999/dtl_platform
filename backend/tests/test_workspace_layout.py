import unittest
import test_calendar
from app.db.models import Bookmark, Note


class WorkspaceLayoutTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.CalendarApiTests.asyncSetUp
    asyncTearDown = test_calendar.CalendarApiTests.asyncTearDown
    request = test_calendar.CalendarApiTests.request

    async def test_personal_order_version_and_default_reset(self):
        _, initial = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(initial['apps'], {'ids': [], 'version': 0})
        path = '/api/workspace/layout/apps'
        status, saved = await self.request('PUT', path, payload={'ids': ['itam', 'workflows', 'bookingreports'], 'expected_version': 0})
        self.assertEqual(status, 200)
        _, other = await self.request('GET', '/api/workspace/layout', user='bob')
        self.assertEqual(other['apps']['ids'], [])
        status, _ = await self.request('PUT', path, payload={'ids': ['workflows'], 'expected_version': 0})
        self.assertEqual(status, 409)
        status, reset = await self.request('PUT', path, payload={'ids': [], 'expected_version': saved['version']})
        self.assertEqual(status, 200); self.assertEqual(reset['ids'], [])
        for ids in [['fake'], ['itam', 'itam']]:
            status, _ = await self.request('PUT', path, payload={'ids': ids, 'expected_version': reset['version']})
            self.assertEqual(status, 422)

    async def test_bookmarks_and_pin_are_private_and_atomic(self):
        _, alice_note = await self.request('POST', '/api/notes', payload={'title': 'mine'})
        _, bob_note = await self.request('POST', '/api/notes', user='bob', payload={'title': 'other'})
        status, _ = await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [bob_note['id']], 'expected_version': 0})
        self.assertEqual(status, 422)
        status, saved = await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [alice_note['id']], 'pin_changes': {alice_note['id']: True}, 'expected_version': 0})
        self.assertEqual(status, 200)
        _, notes = await self.request('GET', '/api/notes'); self.assertTrue(notes[0]['is_pinned'])
        status, _ = await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [], 'pin_changes': {alice_note['id']: False}, 'expected_version': 0})
        self.assertEqual(status, 409)
        _, notes = await self.request('GET', '/api/notes'); self.assertTrue(notes[0]['is_pinned'])
        _, bookmark = await self.request('POST', '/api/bookmarks', payload={'title': 'mine', 'url': 'https://example.com'})
        status, _ = await self.request('PUT', '/api/workspace/layout/bookmarks', user='bob', payload={'ids': [bookmark['id']], 'expected_version': 0})
        self.assertEqual(status, 422)
        await self.request('PATCH', '/api/notes/' + alice_note['id'], payload={'is_pinned': False})
        status, _ = await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [alice_note['id']], 'pin_changes': {alice_note['id']: True}, 'expected_version': saved['version']})
        self.assertEqual(status, 409, 'Undo cannot overwrite a newer manual pin change')

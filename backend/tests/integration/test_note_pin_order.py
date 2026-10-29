from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4

from tests.support.api_case import ApiTestCase

STAMP = datetime(2026, 10, 29, tzinfo=timezone.utc)


class NotePinOrderTests(ApiTestCase):
    async def create(self, title, **fields):
        code, note = await self.request('POST', '/api/notes', payload={'title': title, **fields})
        self.assertEqual(code, 201)
        return note

    async def edit(self, note, minute, **fields):
        with patch('app.modules.notes.service.utcnow', return_value=STAMP + timedelta(minutes=minute)):
            code, value = await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': note['version'], **fields})
        self.assertEqual(code, 200)
        return value

    async def homepage(self):
        code, page = await self.request('GET', '/api/notes/collection/page', query={'filter': 'pinned', 'widget': 'true'})
        self.assertEqual(code, 200)
        return page

    async def test_homepage_uses_latest_pin_before_limit_and_keeps_four_slots(self):
        notes = [await self.create(str(i)) for i in range(8)]
        for minute, note in enumerate(reversed(notes)):
            await self.edit(note, minute, is_pinned=True)
        page = await self.homepage()
        self.assertEqual([item['id'] for item in page['items']], [note['id'] for note in notes[:4]])
        self.assertEqual(page['pinned_total'], 8)
        self.assertEqual(page['hidden'], 4)
        self.assertTrue(page['has_more'])
        self.assertEqual((await self.request('GET', '/api/notes/collection/page', user='bob', query={'filter': 'pinned', 'widget': 'true'}))[1]['items'], [])

    async def test_edits_do_not_move_pins_but_unpin_then_repin_does(self):
        first, second = await self.create('Old'), await self.create('New')
        first = await self.edit(first, 1, is_pinned=True)
        original_stamp = first['pinned_at']
        second = await self.edit(second, 2, is_pinned=True)
        first = await self.edit(first, 3, content='Updated content', is_pinned=True)
        self.assertEqual(first['pinned_at'], original_stamp)
        self.assertEqual([item['id'] for item in (await self.homepage())['items']], [second['id'], first['id']])
        first = await self.edit(first, 4, is_pinned=False)
        self.assertIsNone(first['pinned_at'])
        first = await self.edit(first, 5, is_pinned=True)
        self.assertEqual([item['id'] for item in (await self.homepage())['items']], [first['id'], second['id']])
        first = await self.edit(first, 6, is_archived=True)
        self.assertEqual([item['id'] for item in (await self.homepage())['items']], [second['id']])

    async def test_create_pinned_receipt_does_not_change_pin_time_on_retry(self):
        request_id = str(uuid4())
        with patch('app.modules.notes.creation.utcnow', return_value=STAMP):
            first = await self.create('Pinned at creation', is_pinned=True, request_id=request_id)
        with patch('app.modules.notes.creation.utcnow', return_value=STAMP + timedelta(hours=1)):
            retried = await self.create('Pinned at creation', is_pinned=True, request_id=request_id)
        self.assertEqual(first['id'], retried['id'])
        self.assertEqual(first['pinned_at'], retried['pinned_at'])
        self.assertEqual((await self.homepage())['items'][0]['id'], first['id'])

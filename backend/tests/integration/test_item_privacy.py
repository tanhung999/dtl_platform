"""Quyền riêng tư phải được bảo vệ tại API, cả danh sách và chi tiết."""
from sqlalchemy import text

from tests.support.api_case import ApiTestCase
from app.db.access import UserRole, CalendarShare
from app.db.calendar import CalendarEvent
from app.modules.access.service import seed_catalog


class ItemPrivacyTests(ApiTestCase):
    schedule = {'starts_at': '2026-10-12T09:00:00+07:00', 'ends_at': '2026-10-12T10:00:00+07:00', 'is_all_day': False}

    async def grant(self):
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='calendar_sharer'))
            db.add(CalendarShare(owner_id='alice', viewer_id='bob', share_events=True, share_tasks=True, share_notes=True))
            await db.commit()

    async def test_defaults_and_permission_enforced_on_create_and_update(self):
        cases = [('/api/tasks', {'title': 'Task'}, 'PATCH'),
                 ('/api/notes', {'title': 'Note'}, 'PATCH'),
                 ('/api/calendar/events', self.event_payload(), 'PUT')]
        for path, payload, method in cases:
            code, row = await self.request('POST', path, payload=payload)
            self.assertEqual(code, 201, row)
            self.assertFalse(row['is_private'])
            code, _ = await self.request('POST', path, payload={**payload, 'is_private': True})
            self.assertEqual(code, 403, path)
            update = {**payload, 'is_private': True}
            if path == '/api/notes': update['expected_version'] = row['version']
            code, _ = await self.request(method, path + '/' + row['id'], payload=update)
            self.assertEqual(code, 403, path)

    async def test_private_tasks_notes_hidden_from_shared_list_count_and_detail(self):
        await self.grant()
        private_ids = []
        for private in [False, True]:
            code, task = await self.request('POST', '/api/tasks', payload={'title': 'Task', 'due_date': '2026-10-12', 'is_private': private})
            self.assertEqual(code, 201, task)
            code, note = await self.request('POST', '/api/notes', payload={'title': 'Note', 'is_private': private, 'calendar_schedule': self.schedule})
            self.assertEqual(code, 201, note)
            event_id = note['calendar_schedule']['event_id']
            _, event = await self.request('GET', '/api/calendar/events/' + event_id)
            self.assertEqual(event['is_private'], private)
            if private: private_ids = [('task', task['id']), ('note', event_id)]
        code, page = await self.request('GET', '/api/calendar-sharing/view/alice', user='bob', query=self.range_query())
        self.assertEqual(code, 200, page)
        self.assertEqual(page['total'], 2)
        self.assertEqual(len(page['items']), 2)
        for kind, item_id in private_ids:
            code, _ = await self.request('GET', f'/api/calendar-sharing/view/alice/{kind}/{item_id}', user='bob')
            self.assertEqual(code, 404)

    async def test_note_privacy_sync_both_directions_and_stale_version_rejected(self):
        await self.grant()
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Scheduled', 'calendar_schedule': self.schedule})
        path = '/api/notes/' + note['id']
        event_path = '/api/calendar/events/' + note['calendar_schedule']['event_id']
        code, note = await self.request('PATCH', path, payload={'expected_version': note['version'], 'is_private': True})
        self.assertEqual(code, 200, note)
        _, event = await self.request('GET', event_path)
        self.assertTrue(event['is_private'])
        code, _ = await self.request('PUT', event_path, payload={**self.event_payload(), 'is_private': False})
        self.assertEqual(code, 200)
        _, current = await self.request('GET', path)
        self.assertFalse(current['is_private'])
        self.assertEqual(current['version'], note['version'] + 1)
        code, _ = await self.request('PATCH', path, payload={'expected_version': note['version'], 'content': 'Stale'})
        self.assertEqual(code, 409)

    async def test_revoked_user_can_edit_without_silently_clearing_privacy(self):
        await self.grant()
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Private', 'is_private': True})
        async with self.sessions() as db:
            await db.execute(text("DELETE FROM access_user_roles WHERE user_id='alice'"))
            await db.commit()
        code, saved = await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': note['version'], 'title': 'Edited', 'is_private': True})
        self.assertEqual(code, 200, saved)
        self.assertTrue(saved['is_private'])
        code, _ = await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': saved['version'], 'is_private': False})
        self.assertEqual(code, 403)

    async def test_migration_backfills_legacy_private_notes_without_changing_version(self):
        from app.db.migrations.item_privacy import migrate_item_privacy
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Legacy', 'calendar_schedule': self.schedule})
        async with self.sessions() as db:
            event = await db.get(CalendarEvent, note['calendar_schedule']['event_id'])
            event.is_private = True
            await db.commit()
        async with self.engine.begin() as conn:
            await conn.execute(text('ALTER TABLE tasks DROP COLUMN is_private'))
            await conn.execute(text('ALTER TABLE notes DROP COLUMN is_private'))
            await migrate_item_privacy(conn)
            await migrate_item_privacy(conn)
        _, saved = await self.request('GET', '/api/notes/' + note['id'])
        self.assertTrue(saved['is_private'])
        self.assertEqual(saved['version'], note['version'])
        self.assertEqual(saved['content'], note['content'])

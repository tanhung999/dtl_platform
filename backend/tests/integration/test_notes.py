"""Quyền sở hữu, phiên bản và nâng cấp ghi chú sau khi bỏ liên kết sự kiện."""
from tests.support.api_case import ApiTestCase
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db.migrations.note_versions import migrate_note_versions
from app.db.migrations.remove_note_event_links import migrate_remove_note_event_links

class NotesTests(ApiTestCase):
    async def test_owned_get_update_archive_and_versioned_delete(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Riêng tư', 'content': 'Nội dung'})
        path = '/api/notes/' + note['id']
        self.assertEqual((await self.request('GET', path, user='bob'))[0], 404)
        self.assertEqual((await self.request('GET', path, user=None))[0], 401)
        status, updated = await self.request('PATCH', path, payload={'expected_version': 0, 'content': 'Mới', 'is_archived': True})
        self.assertEqual(status, 200)
        self.assertEqual((await self.request('PATCH', path, payload={'expected_version': 0, 'title': 'Cũ'}))[0], 409)
        self.assertTrue((await self.request('GET', path))[1]['is_archived'])
        _, info = await self.request('GET', path + '/delete-info')
        self.assertNotIn('content', info)
        self.assertFalse(info['has_calendar_schedule'])
        self.assertEqual((await self.request('DELETE', path, payload={'expected_version': 0}))[0], 409)
        self.assertEqual((await self.request('DELETE', path, payload={'expected_version': updated['version']}))[0], 204)

    async def test_migrations_preserve_notes_events_and_schedule(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE notes (id TEXT PRIMARY KEY, color TEXT)'))
                await conn.execute(text("INSERT INTO notes VALUES ('n', '#fbcfe8')"))
                await conn.execute(text('CREATE TABLE calendar_events (id TEXT PRIMARY KEY, search_title TEXT)'))
                await conn.execute(text("INSERT INTO calendar_events VALUES ('e', 'search')"))
                await conn.execute(text('CREATE INDEX ix_calendar_search_trgm ON calendar_events (search_title)'))
                await conn.execute(text('CREATE TABLE note_calendar_schedules (note_id TEXT, event_id TEXT)'))
                await conn.execute(text("INSERT INTO note_calendar_schedules VALUES ('n', 'e')"))
                await conn.execute(text('CREATE TABLE calendar_event_notes (note_id TEXT, event_id TEXT)'))
                await conn.execute(text("INSERT INTO calendar_event_notes VALUES ('n', 'e')"))
                for _ in range(2):
                    await migrate_note_versions(conn)
                    await migrate_remove_note_event_links(conn)
                self.assertEqual(tuple((await conn.execute(text('SELECT id, color, version FROM notes'))).one()), ('n', '#fbcfe8', 0))
                self.assertEqual(await conn.scalar(text('SELECT id FROM calendar_events')), 'e')
                self.assertEqual(tuple((await conn.execute(text('SELECT * FROM note_calendar_schedules'))).one()), ('n', 'e'))
                self.assertIsNone(await conn.scalar(text("SELECT name FROM sqlite_master WHERE name='calendar_event_notes'")))
        finally:
            await engine.dispose()

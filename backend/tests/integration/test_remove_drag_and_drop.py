"""Gỡ kéo thả không làm mất dữ liệu nghiệp vụ và vẫn nâng cấp DB cũ được."""
from sqlalchemy import inspect, text
from tests.support.api_case import ApiTestCase
from app.db.migrations.runner import upgrade


class RemoveDragAndDropTests(ApiTestCase):
    async def test_old_schema_upgrade_preserves_rows_and_never_recreates_drag_tables(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Keep note', 'content': 'Keep content', 'is_pinned': True})
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Keep task', 'due_date': '2026-10-22'})
        _, event = await self.request('POST', payload=self.event_payload(title='Keep event'))
        _, bookmark = await self.request('POST', '/api/bookmarks', payload={'title': 'Keep bookmark', 'url': 'https://example.com'})
        async with self.engine.begin() as conn:
            for sql in (
                'CREATE TABLE workspace_layouts (user_id TEXT, kind TEXT, ordered_ids TEXT)',
                'CREATE TABLE workspace_widget_layouts (user_id TEXT, columns TEXT)',
                'ALTER TABLE notes ADD COLUMN sort_order BIGINT DEFAULT 0',
                'CREATE INDEX ix_notes_owner_order ON notes(user_id, sort_order)',
                'ALTER TABLE tasks ADD COLUMN display_order INTEGER DEFAULT 0',
                'ALTER TABLE bookmarks ADD COLUMN display_order INTEGER DEFAULT 0',
                'ALTER TABLE workspace_versions ADD COLUMN layout BIGINT DEFAULT 0',
                'ALTER TABLE workspace_versions ADD COLUMN widget_layout BIGINT DEFAULT 0',
            ):
                await conn.execute(text(sql))
            for _ in range(2):
                await upgrade(conn)
            tables = await conn.run_sync(lambda sync: inspect(sync).get_table_names())
            self.assertNotIn('workspace_layouts', tables)
            self.assertNotIn('workspace_widget_layouts', tables)
            for table, obsolete in [('notes', {'sort_order'}), ('tasks', {'display_order'}), ('bookmarks', {'display_order'}), ('workspace_versions', {'layout', 'widget_layout'})]:
                columns = await conn.run_sync(lambda sync, table=table: {c['name'] for c in inspect(sync).get_columns(table)})
                self.assertFalse(columns & obsolete, (table, columns))
            self.assertEqual(await conn.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='workspace_003_remove_drag_and_drop'")), 1)
        self.assertEqual((await self.request('GET', '/api/notes/' + note['id']))[1]['content'], 'Keep content')
        self.assertTrue((await self.request('GET', '/api/notes/' + note['id']))[1]['is_pinned'])
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id']))[1]['due_date'], '2026-10-22')
        self.assertEqual((await self.request('GET', '/api/calendar/events/' + event['id']))[1]['title'], 'Keep event')
        self.assertIn(bookmark['id'], [row['id'] for row in (await self.request('GET', '/api/bookmarks'))[1]])

    async def test_removed_routes_are_unavailable(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Note'})
        _, event = await self.request('POST', payload=self.event_payload())
        for method, path in [('GET', '/api/workspace/layout'), ('PUT', '/api/workspace/layout/notes'),
            ('GET', '/api/workspace/widgets'), ('PUT', '/api/workspace/widgets'),
            ('POST', '/api/notes/' + note['id'] + '/move'), ('PATCH', '/api/calendar/events/' + event['id'] + '/schedule')]:
            self.assertEqual((await self.request(method, path, guard=False))[0], 404, path)

    async def test_pin_archive_restore_and_delete_use_note_version_without_layout(self):
        notes = []
        for title in ('First', 'Second', 'Third'):
            notes.append((await self.request('POST', '/api/notes', payload={'title': title}))[1])
        async def page(**query):
            return (await self.request('GET', '/api/notes/collection/page', query=query))[1]
        self.assertEqual([row['id'] for row in (await page())['items']], [row['id'] for row in reversed(notes)])
        path = '/api/notes/' + notes[0]['id']
        await self.request('PATCH', path, payload={'expected_version': 0, 'is_pinned': True})
        self.assertEqual((await page())['items'][0]['id'], notes[0]['id'])
        self.assertEqual((await self.request('PATCH', path, payload={'expected_version': 0, 'is_pinned': False}))[0], 409)
        await self.request('PATCH', path, payload={'expected_version': 1, 'is_archived': True})
        self.assertEqual((await page())['total'], 2)
        self.assertEqual((await page(archived=True))['total'], 1)
        await self.request('PATCH', path, payload={'expected_version': 2, 'is_archived': False})
        self.assertEqual((await page())['items'][0]['id'], notes[0]['id'])
        self.assertEqual((await self.request('DELETE', path))[0], 204)
        self.assertEqual((await page())['total'], 2)

"""Order cleanup regression tests, using an isolated database only."""
import unittest
from tests.support import api_case as test_calendar
from sqlalchemy import text
from app.db.models import Bookmark, Note
from app.db.workspace_layout import WorkspaceLayout
from app.db.migrations.workspace_order_cleanup import migrate_workspace_order_cleanup
from app.db.migrations.runner import upgrade


class WorkspaceOrderCleanupTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def test_archive_delete_and_restore_note(self):
        notes = []
        for title in ('first', 'second', 'third'):
            _, note = await self.request('POST', '/api/notes', payload={'title': title})
            notes.append(note['id'])
        path = '/api/workspace/layout/notes'
        _, saved = await self.request('PUT', path, payload={'ids': notes, 'expected_version': 0})
        status, _ = await self.request('PATCH', '/api/notes/' + notes[1], payload={'is_archived': True, 'expected_version': 0})
        self.assertEqual(status, 200)
        _, layouts = await self.request('GET', '/api/workspace/layout')
        archived = layouts['notes']
        self.assertEqual(archived['ids'], [notes[0], notes[2]])
        self.assertGreater(archived['version'], saved['version'])
        status, _ = await self.request('PUT', path, payload={'ids': notes, 'expected_version': saved['version']})
        self.assertEqual(status, 409, 'A stale tab cannot restore the removed order entry')
        status, cleaned = await self.request('PUT', path, payload={'ids': [notes[2], notes[1], notes[0], 'deleted-id'], 'expected_version': archived['version']})
        self.assertEqual(status, 200)
        self.assertEqual(cleaned['ids'], [notes[2], notes[0]])
        status, _ = await self.request('DELETE', '/api/notes/' + notes[0])
        self.assertEqual(status, 204)
        _, layouts = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(layouts['notes']['ids'], [notes[2]])
        self.assertGreater(layouts['notes']['version'], cleaned['version'])
        await self.request('PATCH', '/api/notes/' + notes[1], payload={'is_archived': False, 'expected_version': 1})
        _, visible = await self.request('GET', '/api/notes')
        self.assertIn(notes[1], [note['id'] for note in visible])
        _, layouts = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(layouts['notes']['ids'], [notes[2], notes[1]], 'Restore appends instead of resurrecting the old slot')

    async def test_private_bookmark_delete_and_foreign_note_are_isolated(self):
        _, bookmark = await self.request('POST', '/api/bookmarks', payload={'title': 'mine', 'url': 'https://example.com'})
        _, saved = await self.request('PUT', '/api/workspace/layout/bookmarks', payload={'ids': [bookmark['id']], 'expected_version': 0})
        status, _ = await self.request('DELETE', '/api/bookmarks/' + bookmark['id'], user='bob')
        self.assertEqual(status, 404)
        _, layouts = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(layouts['bookmarks'], saved)
        await self.request('DELETE', '/api/bookmarks/' + bookmark['id'])
        _, layouts = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(layouts['bookmarks']['ids'], [])
        status, filtered = await self.request('PUT', '/api/workspace/layout/bookmarks', payload={'ids': [bookmark['id']], 'expected_version': layouts['bookmarks']['version']})
        self.assertEqual(status, 200)
        self.assertEqual(filtered['ids'], [])
        _, foreign = await self.request('POST', '/api/notes', user='bob', payload={'title': 'private'})
        status, _ = await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [foreign['id']], 'expected_version': 0})
        self.assertEqual(status, 422)
        status, _ = await self.request('DELETE', '/api/notes/' + foreign['id'])
        self.assertEqual(status, 404)

    async def test_cleanup_is_in_same_transaction_and_notifies_layout(self):
        from app.modules.notes.router import delete_note
        _, note = await self.request('POST', '/api/notes', payload={'title': 'rollback'})
        await self.request('PUT', '/api/workspace/layout/notes', payload={'ids': [note['id']], 'expected_version': 0})
        async with self.sessions() as db:
            user = await db.get(test_calendar.User, 'alice')
            await delete_note(note['id'], user, db, expected_version=note['version'])
            await db.flush()
            layout = await db.get(WorkspaceLayout, ('alice', 'notes'))
            self.assertEqual(layout.ordered_ids, [])
            from app.core.realtime import prepare_changes
            changes = await prepare_changes(db)
            self.assertTrue({'layout', 'notes'}.issubset(changes['alice']))
            await db.rollback()
        _, layouts = await self.request('GET', '/api/workspace/layout')
        self.assertEqual(layouts['notes']['ids'], [note['id']])
        _, notes = await self.request('GET', '/api/notes')
        self.assertEqual(notes[0]['id'], note['id'])

    async def test_global_bookmark_removal_cleans_each_personal_layout(self):
        async with self.sessions() as db:
            db.add(Bookmark(id='shared', user_id='alice', title='shared', url='https://example.com', is_global=True))
            await db.commit()
        for user in ('alice', 'bob'):
            await self.request('PUT', '/api/workspace/layout/bookmarks', user=user, payload={'ids': ['shared'], 'expected_version': 0})
        status, _ = await self.request('DELETE', '/api/bookmarks/shared')
        self.assertEqual(status, 204)
        for user in ('alice', 'bob'):
            _, layouts = await self.request('GET', '/api/workspace/layout', user=user)
            self.assertEqual(layouts['bookmarks'], {'ids': [], 'version': 2})

    async def test_historical_cleanup_preserves_order_ownership_and_is_idempotent(self):
        async with self.sessions() as db:
            db.add_all([
                Note(id='n1', user_id='alice', title='one'),
                Note(id='n2', user_id='alice', title='two'),
                Note(id='archived', user_id='alice', title='old', is_archived=True),
                Note(id='foreign', user_id='bob', title='private'),
                Bookmark(id='global', user_id=None, title='shared', url='https://example.com', is_global=True),
                Bookmark(id='mine', user_id='alice', title='mine', url='https://example.com', is_global=False),
            ])
            db.add_all([
                WorkspaceLayout(user_id='alice', kind='apps', ordered_ids=['itam', 'retired-app', 'workflows', 'itam'], version=5),
                WorkspaceLayout(user_id='alice', kind='notes', ordered_ids=['n2', 'missing', 'archived', 'foreign', 'n1', 'n2'], version=7),
                WorkspaceLayout(user_id='bob', kind='notes', ordered_ids=['foreign'], version=3),
                WorkspaceLayout(user_id='alice', kind='bookmarks', ordered_ids=['mine', 'global', 'gone'], version=2),
                WorkspaceLayout(user_id='bob', kind='bookmarks', ordered_ids=['mine', 'global'], version=4),
            ])
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_workspace_order_cleanup(conn)
            await migrate_workspace_order_cleanup(conn)
        async with self.sessions() as db:
            expected = {
                ('alice', 'apps'): (['itam', 'workflows'], 6),
                ('alice', 'notes'): (['n2', 'n1'], 8),
                ('bob', 'notes'): (['foreign'], 3),
                ('alice', 'bookmarks'): (['mine', 'global'], 3),
                ('bob', 'bookmarks'): (['global'], 5),
            }
            for key, (ids, version) in expected.items():
                row = await db.get(WorkspaceLayout, key)
                self.assertEqual((row.ordered_ids, row.version), (ids, version))

    async def test_versioned_upgrade_runs_cleanup_only_once(self):
        async with self.engine.begin() as conn:
            await upgrade(conn)
            await upgrade(conn)
            count = await conn.scalar(text("SELECT COUNT(*) FROM schema_migrations WHERE version='workspace_001_prune_order_ids'"))
            self.assertEqual(count, 1)

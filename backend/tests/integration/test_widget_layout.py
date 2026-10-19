import unittest
from tests.support import api_case as test_calendar
from app.db.widget_layout import WorkspaceWidgetLayout
from app.modules.workspace.widget_layout import DEFAULT_COLUMNS, normalize_columns


class WidgetLayoutTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = test_calendar.ApiTestCase.asyncSetUp
    asyncTearDown = test_calendar.ApiTestCase.asyncTearDown
    request = test_calendar.ApiTestCase.request

    async def test_defaults_personal_persistence_and_stale_writes(self):
        path = '/api/workspace/widgets'
        status, initial = await self.request('GET', path)
        self.assertEqual(status, 200)
        self.assertEqual(initial['columns'], {k: list(v) for k, v in DEFAULT_COLUMNS.items()})
        status, saved = await self.request('PUT', path, payload={'columns': {'launcher': ['calendar', 'tasks'], 'tasks': [], 'notes': ['apps', 'bookmarks', 'notes']}, 'schema_version': 1, 'expected_version': 0})
        self.assertEqual(status, 200)
        self.assertEqual(saved['version'], 1)
        _, reloaded = await self.request('GET', path)
        self.assertEqual(saved, reloaded)
        _, other = await self.request('GET', path, user='bob')
        self.assertEqual(other, initial)
        status, _ = await self.request('PUT', path, payload={'columns': initial['columns'], 'expected_version': 0})
        self.assertEqual(status, 409)
        _, after = await self.request('GET', path)
        self.assertEqual(after, saved)
        status, _ = await self.request('GET', path, user=None)
        self.assertEqual(status, 401)

    async def test_old_layout_merges_new_widgets_and_ignores_removed_ids(self):
        columns = {'launcher': ['calendar', 'calendar', 'retired'], 'tasks': ['apps'], 'invalid-column': ['notes']}
        expected = {'launcher': ['calendar', 'bookmarks'], 'tasks': ['apps', 'tasks'], 'notes': ['notes']}
        self.assertEqual(normalize_columns(columns), expected)
        self.assertEqual(normalize_columns(expected), expected)
        async with self.sessions() as db:
            db.add(WorkspaceWidgetLayout(user_id='alice', columns=columns, version=4, schema_version=1))
            await db.commit()
        _, result = await self.request('GET', '/api/workspace/widgets')
        self.assertEqual(result['columns'], expected)
        self.assertEqual(result['version'], 4)
        status, result = await self.request('PUT', '/api/workspace/widgets', payload={'columns': columns, 'expected_version': 4})
        self.assertEqual(status, 200)
        self.assertEqual(result['columns'], expected)
        async with self.sessions() as db:
            self.assertEqual((await db.get(WorkspaceWidgetLayout, 'alice')).columns, expected)

    async def test_schema_versions_bounds_and_owner_are_validated(self):
        for bad in ({'schema_version': 2}, {'expected_version': -1}, {'user_id': 'bob'}, {'columns': {'notes': ['notes'] * 101}}):
            payload = {'columns': {}, 'schema_version': 1, 'expected_version': 0, **bad}
            status, _ = await self.request('PUT', '/api/workspace/widgets', payload=payload)
            self.assertEqual(status, 422)
        async with self.sessions() as db:
            db.add(WorkspaceWidgetLayout(user_id='alice', columns={}, version=1, schema_version=2))
            await db.commit()
        for method in ('GET', 'PUT'):
            status, _ = await self.request(method, '/api/workspace/widgets', payload={'columns': {}, 'expected_version': 1} if method == 'PUT' else None)
            self.assertEqual(status, 409, 'An older app must not overwrite a future layout format')

    async def test_save_rollback_and_realtime_topic(self):
        from app.modules.workspace.widgets_router import save_widgets
        from app.modules.workspace.widget_layout import WidgetLayoutWrite
        from app.core.realtime import prepare_changes
        async with self.sessions() as db:
            user = await db.get(test_calendar.User, 'alice')
            await save_widgets(WidgetLayoutWrite(columns={}, expected_version=0), user, db)
            changes = await prepare_changes(db)
            self.assertIn('widget-layout', changes['alice'])
            await db.rollback()
        _, result = await self.request('GET', '/api/workspace/widgets')
        self.assertEqual(result['version'], 0)

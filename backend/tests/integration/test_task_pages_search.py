"""Widget, trang đầy đủ, tìm kiếm và Lịch có phạm vi dữ liệu độc lập."""
from sqlalchemy import event, text
from tests.support.api_case import ApiTestCase
from app.db.migrations.task_search import migrate_task_search


class TaskPagesSearchTests(ApiTestCase):
    async def test_eight_and_twenty_five_pages_keep_global_counts_and_calendar(self):
        rows = []
        for i in range(31):
            _, row = await self.request('POST', '/api/tasks', payload={'title': f'Task {i}', 'due_date': '2099-10-22'})
            rows.append(row)
        endpoint = '/api/tasks/collection'
        _, first = await self.request('GET', endpoint, query={'limit': 8})
        self.assertEqual((len(first['items']), first['total'], first['counts']['ALL']), (8, 31, 31))
        _, second = await self.request('GET', endpoint, query={'limit': 8, 'offset': 8, 'after': first['next_cursor']})
        self.assertEqual(len(second['items']), 8)
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})
        _, full = await self.request('GET', endpoint, query={'limit': 25})
        self.assertEqual(len(full['items']), 25)
        _, last = await self.request('GET', endpoint, query={'limit': 25, 'offset': 25, 'after': full['next_cursor']})
        self.assertEqual(len(last['items']), 6)
        self.assertFalse(last['has_more'])
        _, calendar = await self.request('GET', '/api/tasks/calendar/page', query={'start': '2099-10-22', 'end': '2099-10-23'})
        self.assertEqual(len(calendar['items']), 31)

    async def test_search_is_accent_insensitive_private_literal_and_updates_after_edit(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Đề XUẤT', 'description': 'Họp phòng kinh doanh'})
        await self.request('POST', '/api/tasks', user='bob', payload={'title': 'Đề xuất của Bob'})
        endpoint = '/api/tasks/collection'
        sql = []
        def trace(conn, cursor, statement, params, context, many):
            sql.append(statement)
        event.listen(self.engine.sync_engine, 'before_cursor_execute', trace)
        try:
            for query in ('de xuat', 'ĐỀ xuất', 'PHONG KINH DOANH'):
                _, page = await self.request('GET', endpoint, query={'q': query})
                self.assertEqual([row['id'] for row in page['items']], [task['id']])
                self.assertEqual(page['counts']['ALL'], 1)
            self.assertTrue(any('tasks.search_text LIKE' in statement for statement in sql))
            projections = [statement.split('FROM tasks')[0] for statement in sql if 'FROM tasks' in statement]
            self.assertFalse(any('tasks.search_text' in projection for projection in projections))
        finally:
            event.remove(self.engine.sync_engine, 'before_cursor_execute', trace)
        for keyword in ('%', '_', 'd', 'unknown'):
            _, page = await self.request('GET', endpoint, query={'q': keyword})
            self.assertEqual(page['items'], [])
            self.assertEqual(page['counts']['ALL'], 1)
        await self.request('PATCH', '/api/tasks/' + task['id'], payload={'title': 'Mới', 'description': 'Khác'})
        self.assertEqual((await self.request('GET', endpoint, query={'q': 'de xuat'}))[1]['total'], 0)
        self.assertEqual((await self.request('GET', endpoint, query={'q': 'khac'}))[1]['total'], 1)
        self.assertEqual((await self.request('GET', endpoint, query={'q': 'x' * 201}))[0], 422)

    async def test_filter_applies_to_search_and_out_of_range_pages_ignore_old_cursor(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Search done'})
        await self.request('PATCH', '/api/tasks/' + task['id'], payload={'is_completed': True})
        _, page = await self.request('GET', '/api/tasks/collection', query={'q': 'search', 'filter': 'PENDING'})
        self.assertEqual(page['total'], 0)
        self.assertEqual(page['counts'], {'ALL': 1, 'PENDING': 0, 'DONE': 1, 'OVERDUE': 0})
        _, page = await self.request('GET', '/api/tasks/collection', query={'limit': 8, 'offset': 32, 'after': 'deleted-anchor'})
        self.assertEqual(page['offset'], 0)
        self.assertEqual(len(page['items']), 1)

    async def test_migration_backfills_old_tasks_without_changing_business_fields(self):
        async with self.engine.begin() as conn:
            await conn.execute(text('ALTER TABLE tasks DROP COLUMN search_text'))
            await conn.execute(text("INSERT INTO tasks (id, user_id, title, description, priority, is_completed, version, deadline_version, created_at, updated_at) VALUES ('legacy', 'alice', 'Đề xuất', 'Nội dung', 'MEDIUM', 0, 4, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"))
            for _ in range(2):
                await migrate_task_search(conn)
            row = (await conn.execute(text("SELECT title, description, version, deadline_version, search_text FROM tasks WHERE id='legacy'"))).one()
            self.assertEqual(tuple(row), ('Đề xuất', 'Nội dung', 4, 2, 'de xuat\nnoi dung'))

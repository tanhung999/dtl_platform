"""Run the external notification contract in disposable PostgreSQL schemas."""
import os
import unittest
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

url = os.environ.get('NOTIFICATION_TEST_DATABASE_URL', '')
if not url.startswith('postgresql+asyncpg://test@127.0.0.1:5549/test'):
    raise RuntimeError('Use the dedicated local notification test database on port 5549.')

from tests.integration.test_external_notification_sync import ExternalNotificationSyncTests


class PostgreSQLExternalNotificationSyncTests(ExternalNotificationSyncTests):
    async def asyncSetUp(self):
        self.schema = 'external_notice_' + uuid4().hex
        self.admin = create_async_engine(url)
        async with self.admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        engine = create_async_engine(url, connect_args={'server_settings': {'search_path': self.schema}})
        try:
            with patch('tests.support.api_case.create_async_engine', return_value=engine):
                await super().asyncSetUp()
        except BaseException:
            await engine.dispose(); await self.drop_schema(); raise

    async def drop_schema(self):
        assert self.schema.startswith('external_notice_') and len(self.schema) == 48
        async with self.admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        await self.admin.dispose()

    async def asyncTearDown(self):
        try:
            await super().asyncTearDown()
        finally:
            await self.drop_schema()

    async def test_parallel_retries_create_one_delivery(self):
        import asyncio
        rows = await asyncio.gather(*(self.notice() for _ in range(4)))
        self.assertEqual(len({row['id'] for row in rows}), 1)
        self.assertEqual(sum(not row['duplicate'] for row in rows), 1)

    async def test_parallel_platform_and_source_reads_keep_one_revision(self):
        import asyncio
        from app.db.notifications import ExternalNotificationState
        row = await self.notice()
        results = await asyncio.gather(
            self.request('PATCH', '/api/notifications/'+row['id'], payload={'read': True}),
            self.read_from_source(row, True, 0), self.read_from_source(row, True, 0))
        self.assertTrue(all(code in (200, 204) for code, _ in results), results)
        async with self.sessions() as db:
            self.assertEqual((await db.get(ExternalNotificationState, row['id'])).read_version, 1)


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(PostgreSQLExternalNotificationSyncTests))
    raise SystemExit(not result.wasSuccessful())

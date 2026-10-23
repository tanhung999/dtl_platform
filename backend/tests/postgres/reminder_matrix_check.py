"""Chạy lại hợp đồng API trên PostgreSQL, mỗi ca dùng schema UUID riêng."""
import os
import unittest
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Fixture SQLite đặt lại biến môi trường lúc import; giữ URL kiểm thử trước đó.
database_url = os.environ.get('DATABASE_URL', '')
if not database_url.startswith('postgresql+asyncpg://'):
    raise RuntimeError('Cần DATABASE_URL PostgreSQL cho kiểm tra này.')

from tests.integration.test_reminder_matrix import ReminderMatrixTests


class PostgreSQLReminderMatrixTests(ReminderMatrixTests):
    async def asyncSetUp(self):
        self.schema = 'notification_api_' + uuid4().hex
        self.admin_engine = create_async_engine(database_url)
        async with self.admin_engine.begin() as connection:
            await connection.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        engine = create_async_engine(database_url, connect_args={'server_settings': {'search_path': self.schema}})
        try:
            with patch('tests.support.api_case.create_async_engine', return_value=engine):
                await super().asyncSetUp()
        except Exception:
            await engine.dispose()
            await self.drop_schema()
            raise

    async def drop_schema(self):
        assert self.schema.startswith('notification_api_') and len(self.schema) == 49
        async with self.admin_engine.begin() as connection:
            await connection.execute(text(f'DROP SCHEMA "{self.schema}" CASCADE'))
        await self.admin_engine.dispose()

    async def asyncTearDown(self):
        try:
            await super().asyncTearDown()
        finally:
            await self.drop_schema()


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PostgreSQLReminderMatrixTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)

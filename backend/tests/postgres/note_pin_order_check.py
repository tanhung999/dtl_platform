"""Pinned ordering and additive migration on isolated PostgreSQL schemas."""
import os
import unittest
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

database_url = os.environ.get('DATABASE_URL', '')
if not database_url.startswith('postgresql+asyncpg://'):
    raise RuntimeError('A PostgreSQL test URL is required.')

from tests.integration.test_note_pin_order import NotePinOrderTests
from app.db.migrations.note_pin_time import migrate_note_pin_time


class PostgreSQLPinOrderTests(NotePinOrderTests):
    async def asyncSetUp(self):
        self.schema = 'note_pin_qa_' + uuid4().hex
        self.admin_engine = create_async_engine(database_url)
        async with self.admin_engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{self.schema}"'))
        engine = create_async_engine(database_url, connect_args={'server_settings': {'search_path': self.schema}})
        try:
            with patch('tests.support.api_case.create_async_engine', return_value=engine):
                await super().asyncSetUp()
        except BaseException:
            await engine.dispose()
            await self.clean_schema()
            raise

    async def clean_schema(self):
        async with self.admin_engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{self.schema}" CASCADE'))
        await self.admin_engine.dispose()

    async def asyncTearDown(self):
        try:
            await super().asyncTearDown()
        finally:
            await self.clean_schema()


class PostgreSQLPinMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_pins_migrate_without_reordering_or_overwriting_new_pin_times(self):
        schema = 'note_pin_legacy_qa_' + uuid4().hex
        engine = create_async_engine(database_url)
        try:
            async with engine.begin() as conn:
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
                await conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
                await conn.execute(text('CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT, is_archived BOOLEAN, is_pinned BOOLEAN, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)'))
                await conn.execute(text("INSERT INTO notes VALUES ('old','alice',false,true,'2026-10-01','2026-10-28'), ('new','alice',false,true,'2026-10-20','2026-10-21'), ('plain','alice',false,false,'2026-10-22','2026-10-23')"))
                await migrate_note_pin_time(conn)
                self.assertEqual((await conn.execute(text('SELECT id FROM notes WHERE is_pinned ORDER BY pinned_at DESC'))).scalars().all(), ['new', 'old'])
                await conn.execute(text("UPDATE notes SET pinned_at='2026-10-29' WHERE id='old'"))
                await migrate_note_pin_time(conn)
                self.assertEqual(await conn.scalar(text('SELECT id FROM notes WHERE is_pinned ORDER BY pinned_at DESC LIMIT 1')), 'old')
        finally:
            async with engine.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            await engine.dispose()


if __name__ == '__main__':
    # Run only the PostgreSQL subclasses, not the imported SQLite base class.
    suite = unittest.TestSuite()
    for case in (PostgreSQLPinOrderTests, PostgreSQLPinMigrationTests):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(case))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())

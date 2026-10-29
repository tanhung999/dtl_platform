import unittest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from app.db.migrations.note_pin_time import migrate_note_pin_time


class NotePinMigrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_legacy_pin_order_is_preserved_and_rerun_keeps_real_pin_times(self):
        engine = create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT, is_archived BOOLEAN, is_pinned BOOLEAN, created_at DATETIME, updated_at DATETIME)'))
                await conn.execute(text("INSERT INTO notes VALUES ('old','alice',false,true,'2026-10-01 00:00:00','2026-10-28 00:00:00'), ('new','alice',false,true,'2026-10-20 00:00:00','2026-10-21 00:00:00'), ('plain','alice',false,false,'2026-10-22 00:00:00','2026-10-23 00:00:00')"))
                await migrate_note_pin_time(conn)
                rows = (await conn.execute(text('SELECT id, pinned_at FROM notes ORDER BY pinned_at DESC'))).all()
                self.assertEqual([row[0] for row in rows], ['new', 'old', 'plain'])
                self.assertIsNone(rows[-1][1])
                await conn.execute(text("UPDATE notes SET pinned_at='2026-10-29 00:00:00' WHERE id='old'"))
                await migrate_note_pin_time(conn)
                self.assertEqual(await conn.scalar(text('SELECT id FROM notes ORDER BY pinned_at DESC LIMIT 1')), 'old')
                indexes = await conn.run_sync(lambda sync: {index['name'] for index in inspect(sync).get_indexes('notes')})
                # SQLite's inspector can omit expression indexes, so inspect
                # its catalog directly to verify the migration's index.
                self.assertTrue('ix_notes_owner_pin_time' in indexes or await conn.scalar(text("SELECT name FROM sqlite_master WHERE type='index' AND name='ix_notes_owner_pin_time'")))
        finally:
            await engine.dispose()

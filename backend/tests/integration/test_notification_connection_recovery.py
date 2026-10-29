"""Read-all can recover an idle SQLite connection closed outside the pool."""
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from tests.support.api_case import ApiTestCase
from app.core import database
from app.core.database import Base, get_db
from app.db.models import User
from app.db.notifications import Notification
from app.main import app


class NotificationConnectionRecoveryTests(ApiTestCase):
    async def test_read_all_reconnects_after_idle_connection_is_closed(self):
        with TemporaryDirectory() as directory:
            path = Path(directory, 'notifications.db').as_posix()
            engine = create_async_engine('sqlite+aiosqlite:///' + path, **database.pool_options)
            sessions = async_sessionmaker(engine, expire_on_commit=False)
            override = app.dependency_overrides.pop(get_db)
            try:
                async with engine.begin() as conn:
                    await conn.run_sync(Base.metadata.create_all)
                stamp = datetime(2026, 10, 10, tzinfo=timezone.utc)
                async with sessions() as db:
                    db.add(User(id='alice', username='alice', email='alice@example.com', full_name='Alice', password_hash='unused'))
                    await db.flush()
                    db.add(Notification(user_id='alice', source='workflows', event_key='recovery', fingerprint='recovery', kind='external.info', title='Recovery', occurred_at=stamp, created_at=stamp))
                    await db.commit()

                with patch.object(database, 'async_session_maker', sessions):
                    code, summary = await self.request('GET', '/api/notifications/summary')
                    self.assertEqual(code, 200)
                    self.assertEqual(summary['unread_count'], 1)
                    async with engine.connect() as conn:
                        raw = await conn.get_raw_connection()
                        driver = raw.driver_connection
                    # The idle connection is now invalid, but has not been
                    # reported to SQLAlchemy by any active request yet.
                    await driver.close()
                    code, _ = await self.request('POST', '/api/notifications/read-all', payload={'through': summary['server_now']})
                    self.assertEqual(code, 204)
                    self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 0)
            finally:
                app.dependency_overrides[get_db] = override
                await engine.dispose()

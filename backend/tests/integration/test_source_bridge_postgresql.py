"""Real PostgreSQL foreign-key/transaction regressions in disposable schemas."""

import os
import unittest
import uuid

from tests.support.api_case import Base  # Register the same tables as production.
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db.models import User
from app.db.notifications import (
    Notification,
    ExternalNotificationState,
    NotificationReadOutbox,
)
from app.modules.notifications import source_bridge as bridge
from app.modules.notifications.external_sync import record_read_change
from tests.support.notification_fixtures import grants


@unittest.skipUnless(
    os.getenv("PLATFORM_TEST_POSTGRES_URL"), "Optional isolated PostgreSQL test service"
)
class PostgreSQLSourceBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        url = make_url(os.environ["PLATFORM_TEST_POSTGRES_URL"])
        if url.host not in {"127.0.0.1", "localhost"}:
            raise RuntimeError(
                "Notification regression tests require a local disposable PostgreSQL service."
            )
        self.schema = "qa_bridge_" + uuid.uuid4().hex
        self.admin = create_async_engine(url, poolclass=NullPool)
        self.addAsyncCleanup(self.admin.dispose)
        async with self.admin.begin() as conn:
            await conn.execute(text("CREATE SCHEMA " + self.schema))
        self.addAsyncCleanup(self.drop_schema)
        self.engine = create_async_engine(
            url,
            poolclass=NullPool,
            connect_args={"server_settings": {"search_path": self.schema}},
        )
        self.addAsyncCleanup(self.engine.dispose)
        async with self.engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessions() as db:
            db.add_all(
                [
                    User(
                        id=name,
                        username=name,
                        email=name + "@example.com",
                        full_name=name,
                        password_hash="isolated-test",
                    )
                    for name in ("alice", "bob")
                ]
            )
            await db.commit()
            await grants(db, linked=True)
            await db.commit()

    async def drop_schema(self):
        async with self.admin.begin() as conn:
            await conn.execute(text("DROP SCHEMA " + self.schema + " CASCADE"))

    def binding(self, source):
        return {
            "source": source,
            "user_id": "alice",
            "recipient_subject": "alice-subject",
            "external_user_id": "alice-external",
            "link_operation_id": "alice-" + source + "-link",
        }

    def item(self, external_id="one", read=False, version=0):
        return {
            "external_id": external_id,
            "title": "Notice",
            "body": "Fixture",
            "kind": "assignment",
            "action_path": "/documents",
            "occurred_at": "2026-11-06T08:00:00+00:00",
            "read": read,
            "read_version": version,
        }

    async def merge(self, source, items):
        async with self.sessions() as db:
            await bridge.merge_feed(
                db, self.binding(source), {"items": items, "visible_known_ids": []}, []
            )
            await bridge.commit(db)

    async def test_first_batch_import_and_replay_all_sources(self):
        for source in ("workflows", "bookingreports", "itam"):
            items = [self.item(str(i), read=i % 2 == 0) for i in range(100)]
            await self.merge(source, items)
            await self.merge(source, items)
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(select(func.count()).select_from(Notification)), 300
            )
            self.assertEqual(
                await db.scalar(
                    select(func.count()).select_from(ExternalNotificationState)
                ),
                300,
            )

    async def test_invalid_batch_rolls_back_parent_and_link_rows(self):
        with self.assertRaises(ValueError):
            await self.merge(
                "workflows", [self.item(), {**self.item("two"), "read_version": -1}]
            )
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(select(func.count()).select_from(Notification)), 0
            )
            self.assertEqual(
                await db.scalar(
                    select(func.count()).select_from(ExternalNotificationState)
                ),
                0,
            )

    async def test_source_read_and_local_outbox_follow_import(self):
        await self.merge("workflows", [self.item()])
        await self.merge("workflows", [self.item(read=True, version=1)])
        async with self.sessions() as db:
            notice = await db.scalar(select(Notification))
            self.assertIsNotNone(notice.read_at)
            notice.read_at = None
            await record_read_change(db, notice)
            await bridge.commit(db)
            queued = await db.get(NotificationReadOutbox, notice.id)
            self.assertEqual(queued.revision, 2)
            self.assertEqual(queued.acknowledged_revision, 0)


if __name__ == "__main__":
    unittest.main()

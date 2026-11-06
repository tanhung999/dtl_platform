import base64
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from sqlalchemy import select
from tests.support.api_case import ApiTestCase
from tests.support.notification_fixtures import bind_history, grants
from app.db.notifications import Notification


class NotificationChronologyTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.today = datetime(2026, 11, 6, 9, tzinfo=timezone.utc)
        async with self.sessions() as db:
            await grants(db, linked=True)
            # Backfilled notices arrive together, despite different source dates.
            db.add_all(
                [
                    self.notice(
                        "old-workflow",
                        "workflows",
                        self.today,
                        datetime(2025, 9, 8, 8, tzinfo=timezone.utc),
                    ),
                    self.notice(
                        "old-assets",
                        "itam",
                        self.today + timedelta(seconds=1),
                        datetime(2026, 10, 1, 8, tzinfo=timezone.utc),
                    ),
                    self.notice(
                        "local",
                        "platform",
                        self.today - timedelta(minutes=1),
                        self.today - timedelta(days=2),
                    ),
                    self.notice(
                        "recent-workflow",
                        "workflows",
                        self.today - timedelta(seconds=1),
                        self.today - timedelta(days=1),
                    ),
                ]
            )
            await bind_history(db)
            await db.commit()

    def notice(self, identifier, source, created_at, occurred_at):
        return Notification(
            id=identifier,
            user_id="alice",
            source=source,
            event_key=identifier,
            fingerprint=identifier,
            kind="external.info" if source != "platform" else "system.info",
            title=identifier,
            body="Fixture",
            resource_type="record",
            created_at=created_at,
            occurred_at=occurred_at,
        )

    async def test_backfilled_external_dates_sort_by_source_time_without_rewriting_storage(
        self,
    ):
        code, page = await self.request("GET", "/api/notifications")
        self.assertEqual(code, 200)
        self.assertEqual(
            [row["id"] for row in page["items"]],
            ["local", "recent-workflow", "old-assets", "old-workflow"],
        )
        old = page["items"][-1]
        self.assertTrue(old["occurred_at"].startswith("2025-09-08"))
        self.assertTrue(old["created_at"].startswith("2026-11-06"))

    async def test_cursor_follows_source_dates_with_no_missing_or_repeated_items(self):
        rows, cursor = [], None
        for _ in range(4):
            query = {"limit": 1}
            if cursor:
                query["before"] = cursor
            code, page = await self.request("GET", "/api/notifications", query=query)
            self.assertEqual(code, 200)
            rows.extend(row["id"] for row in page["items"])
            cursor = page["next_cursor"]
        self.assertEqual(
            rows, ["local", "recent-workflow", "old-assets", "old-workflow"]
        )
        self.assertIsNone(cursor)

    async def test_bell_preview_uses_same_chronology_as_inbox(self):
        code, summary = await self.request("GET", "/api/notifications/summary")
        self.assertEqual(code, 200)
        self.assertEqual(
            [row["id"] for row in summary["preview"]],
            ["local", "recent-workflow", "old-assets", "old-workflow"],
        )

    async def test_tied_source_dates_use_id_for_stable_pagination(self):
        async with self.sessions() as db:
            db.add_all(
                [
                    self.notice(
                        name,
                        "workflows",
                        self.today + timedelta(seconds=index),
                        self.today + timedelta(days=1),
                    )
                    for index, name in enumerate(("tie-a", "tie-b"))
                ]
            )
            await bind_history(db)
            await db.commit()
        _, first = await self.request("GET", "/api/notifications", query={"limit": 1})
        _, second = await self.request(
            "GET",
            "/api/notifications",
            query={"limit": 1, "before": first["next_cursor"]},
        )
        self.assertEqual(
            [first["items"][0]["id"], second["items"][0]["id"]], ["tie-b", "tie-a"]
        )

    async def test_old_open_tab_cursor_restarts_safely(self):
        cursor = base64.urlsafe_b64encode(
            json.dumps([self.today.isoformat(), "old-assets"]).encode()
        ).decode()
        code, page = await self.request(
            "GET", "/api/notifications", query={"before": cursor, "limit": 1}
        )
        self.assertEqual(code, 200)
        self.assertEqual(page["items"][0]["id"], "local")

    async def test_read_all_keeps_ingestion_cutoff_even_when_source_date_is_older(self):
        cutoff = self.today + timedelta(days=1)
        async with self.sessions() as db:
            db.add(
                self.notice(
                    "arrived-later",
                    "workflows",
                    cutoff + timedelta(minutes=1),
                    cutoff - timedelta(days=100),
                )
            )
            await bind_history(db)
            await db.commit()
        with patch("app.modules.notifications.router.utcnow", return_value=cutoff):
            code, _ = await self.request(
                "POST",
                "/api/notifications/read-all",
                payload={"through": cutoff.isoformat()},
            )
        self.assertEqual(code, 204)
        async with self.sessions() as db:
            self.assertIsNone((await db.get(Notification, "arrived-later")).read_at)
            self.assertTrue(
                all(
                    row.read_at is not None
                    for row in (
                        await db.scalars(
                            select(Notification).where(
                                Notification.id != "arrived-later"
                            )
                        )
                    ).all()
                )
            )

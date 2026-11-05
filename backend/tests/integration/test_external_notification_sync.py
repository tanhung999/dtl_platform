"""Signed integration contract using an isolated database, never company services."""

# Initialize the isolated test environment before importing application settings.
from tests.support.api_case import ApiTestCase

import hashlib
import hmac
import json
import time
from unittest.mock import patch

from app.core.config import settings
from app.core.workspace_versions import read_versions
from app.db.applications import (
    Application,
    ApplicationPolicyOwnership,
    UserApplicationAccess,
)
from app.db.notifications import Notification, NotificationReadOutbox
from sqlalchemy import select

from tests.support.notification_fixtures import grants

SECRET = "external-sync-test-secret-123456789012345"


class ExternalNotificationSyncTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            await grants(db, linked=True)
            await db.commit()
        for source in ("workflows", "itam", "bookingreports"):
            setting = patch.object(
                settings, f"NOTIFICATIONS_{source.upper()}_SECRET", SECRET
            )
            setting.start()
            self.addCleanup(setting.stop)

    def binding(self, source="workflows", user="alice"):
        return dict(
            recipient_subject=user + "-subject",
            external_user_id=user + "-external",
            link_operation_id=user + "-" + source + "-link",
        )

    async def signed(
        self,
        payload,
        endpoint="notifications",
        source="workflows",
        *,
        signature_source=None,
    ):
        stamp = str(int(time.time()))
        context = (
            stamp
            + "\n"
            + (signature_source or source)
            + "\n"
            + (endpoint + "\n" if endpoint != "notifications" else "")
        )
        signature = (
            "sha256="
            + hmac.new(
                SECRET.encode(),
                context.encode() + json.dumps(payload).encode(),
                hashlib.sha256,
            ).hexdigest()
        )
        return await self.request(
            "POST",
            f"/api/integrations/{source}/{endpoint}",
            user=None,
            payload=payload,
            headers_extra={
                "X-Notification-Timestamp": stamp,
                "X-Notification-Signature": signature,
            },
        )

    async def notice(self, external_id="notice-1", source="workflows", **extra):
        code, row = await self.signed(
            {
                **self.binding(source),
                "external_id": external_id,
                "title": "Notice",
                **extra,
            },
            source=source,
        )
        self.assertEqual(code, 200, row)
        return row

    async def pending(self, source="workflows"):
        code, result = await self.signed({}, "notification-read-changes", source)
        self.assertEqual(code, 200, result)
        return result["items"]

    async def read_from_source(self, row, read, version, source="workflows"):
        return await self.signed(
            {
                **self.binding(source),
                "external_id": row["external_id"],
                "read": read,
                "expected_version": version,
            },
            "notification-read-state",
            source,
        )

    async def test_all_sources_receive_using_current_grants_without_legacy_allowed_apps(
        self,
    ):
        for source in ("workflows", "itam", "bookingreports"):
            await self.notice(source=source)
        _, summary = await self.request("GET", "/api/notifications/summary")
        self.assertEqual(summary["unread_count"], 3)
        async with self.sessions() as db:
            self.assertGreater((await read_versions(db, "alice"))["notifications"], 0)

    async def test_platform_read_is_durable_retried_until_correct_source_acknowledges(
        self,
    ):
        row = await self.notice()
        await self.request(
            "PATCH", "/api/notifications/" + row["id"], payload={"read": True}
        )
        changes = await self.pending()
        self.assertEqual(changes[0]["read_version"], 1)
        self.assertTrue(changes[0]["read"])
        self.assertEqual(await self.pending(), changes)
        payload = {"items": [{"id": row["id"], "read_version": 1}]}
        self.assertEqual(
            (await self.signed(payload, "notification-read-ack", "itam"))[1][
                "acknowledged"
            ],
            0,
        )
        self.assertEqual(
            (await self.signed(payload, "notification-read-ack"))[1]["acknowledged"], 1
        )
        self.assertEqual(await self.pending(), [])
        self.assertEqual(
            (await self.signed(payload, "notification-read-ack"))[1]["acknowledged"], 0
        )

    async def test_source_read_updates_platform_without_creating_an_echo(self):
        row = await self.notice()
        self.assertEqual((await self.read_from_source(row, True, 0))[0], 200)
        self.assertEqual(
            (await self.request("GET", "/api/notifications/summary"))[1][
                "unread_count"
            ],
            0,
        )
        self.assertEqual(await self.pending(), [])
        self.assertEqual(
            (await self.read_from_source(row, True, 0))[1]["read_version"], 1
        )

    async def test_stale_read_and_ack_cannot_overwrite_a_newer_explicit_change(self):
        row = await self.notice()
        await self.request(
            "PATCH", "/api/notifications/" + row["id"], payload={"read": True}
        )
        await self.request(
            "PATCH", "/api/notifications/" + row["id"], payload={"read": False}
        )
        self.assertEqual((await self.read_from_source(row, True, 0))[0], 409)
        await self.signed(
            {"items": [{"id": row["id"], "read_version": 1}]}, "notification-read-ack"
        )
        pending = await self.pending()
        self.assertEqual(pending[0]["read_version"], 2)
        self.assertFalse(pending[0]["read"])
        self.assertEqual((await self.read_from_source(row, True, 2))[0], 200)
        self.assertEqual(await self.pending(), [])

    async def test_read_all_queues_only_real_read_changes_and_keeps_sources_separate(
        self,
    ):
        for source in ("workflows", "itam", "bookingreports"):
            await self.notice(source=source)
        through = (await self.request("GET", "/api/notifications/summary"))[1][
            "server_now"
        ]
        await self.request(
            "POST", "/api/notifications/read-all", payload={"through": through}
        )
        for source in ("workflows", "itam", "bookingreports"):
            self.assertEqual(len(await self.pending(source)), 1)
        await self.request(
            "POST", "/api/notifications/read-all", payload={"through": through}
        )
        self.assertEqual((await self.pending())[0]["read_version"], 1)

    async def test_duplicate_ingestion_preserves_current_read_state(self):
        row = await self.notice()
        await self.request(
            "PATCH", "/api/notifications/" + row["id"], payload={"read": True}
        )
        again = await self.notice()
        self.assertTrue(again["duplicate"])
        self.assertTrue(again["read"])
        self.assertEqual(again["read_version"], 1)
        self.assertEqual(
            (
                await self.signed(
                    {**self.binding(), "external_id": "notice-1", "title": "Different"}
                )
            )[0],
            409,
        )

    async def test_revoked_grant_and_disabled_app_hide_notices_and_stop_sync(self):
        row = await self.notice()
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ("alice", "workflows"))
            grant.enabled = False
            await db.commit()
        self.assertEqual(
            (await self.request("GET", "/api/notifications/summary"))[1][
                "unread_count"
            ],
            0,
        )
        self.assertEqual(
            (
                await self.request(
                    "PATCH", "/api/notifications/" + row["id"], payload={"read": True}
                )
            )[0],
            404,
        )
        self.assertEqual((await self.read_from_source(row, True, 0))[0], 403)
        self.assertEqual(await self.pending(), [])
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ("alice", "workflows"))
            grant.enabled = True
            app = await db.get(Application, "workflows")
            app.is_active = False
            await db.commit()
        self.assertEqual(
            (await self.request("GET", "/api/notifications"))[1]["items"], []
        )

    async def test_relink_hides_old_history_and_pending_reads_and_rejects_old_account(
        self,
    ):
        row = await self.notice()
        await self.request(
            "PATCH", "/api/notifications/" + row["id"], payload={"read": True}
        )
        async with self.sessions() as db:
            link = await db.get(ApplicationPolicyOwnership, ("alice", "workflows"))
            link.external_user_id = "replacement"
            link.operation_id = "replacement-link"
            await db.commit()
        self.assertEqual(
            (await self.request("GET", "/api/notifications"))[1]["items"], []
        )
        self.assertEqual(await self.pending(), [])
        self.assertEqual((await self.read_from_source(row, True, 0))[0], 409)
        self.assertEqual(
            (
                await self.signed(
                    {**self.binding(), "external_id": "late", "title": "Old account"}
                )
            )[0],
            409,
        )
        code, new = await self.signed(
            {
                **self.binding(),
                "external_user_id": "replacement",
                "link_operation_id": "replacement-link",
                "external_id": "notice-1",
                "title": "New account",
            }
        )
        self.assertEqual(code, 200, new)
        self.assertNotEqual(new["id"], row["id"])

    async def test_wrong_identity_signature_or_recipient_never_delivers(self):
        data = {**self.binding(), "external_id": "x", "title": "No"}
        self.assertEqual((await self.signed(data, signature_source="itam"))[0], 401)
        self.assertEqual(
            (await self.signed({**data, "recipient_subject": "unknown"}))[0], 404
        )
        self.assertEqual(
            (await self.signed({**data, "recipient_user_id": "bob"}))[0], 404
        )
        self.assertEqual(
            (await self.signed({"limit": 101}, "notification-read-changes"))[0], 422
        )
        self.assertEqual(
            (await self.request("GET", "/api/notifications", user="bob"))[1]["items"],
            [],
        )

    async def test_initial_read_and_muting_do_not_send_fake_read_events(self):
        row = await self.notice(read=True)
        self.assertTrue(row["read"])
        self.assertEqual(await self.pending(), [])
        await self.request(
            "PATCH",
            "/api/notifications/preferences",
            payload={"expected_version": 0, "workflows": False},
        )
        muted = await self.notice("muted")
        self.assertTrue(muted["muted"])
        self.assertFalse(muted["read"])
        self.assertEqual(await self.pending(), [])
        async with self.sessions() as db:
            self.assertEqual(
                len((await db.scalars(select(NotificationReadOutbox))).all()), 0
            )
            self.assertEqual(len((await db.scalars(select(Notification))).all()), 2)

    async def test_additive_migration_is_repeatable_and_preserves_existing_deliveries(
        self,
    ):
        from app.db.migrations.notification_sync import migrate_notification_sync
        from app.db.notifications import ExternalNotificationState

        row = await self.notice()
        async with self.engine.begin() as conn:
            await conn.run_sync(NotificationReadOutbox.__table__.drop)
            await conn.run_sync(ExternalNotificationState.__table__.drop)
            await migrate_notification_sync(conn)
            await migrate_notification_sync(conn)
        async with self.sessions() as db:
            self.assertIsNotNone(await db.get(Notification, row["id"]))
            self.assertEqual(
                (await db.scalars(select(NotificationReadOutbox))).all(), []
            )

    async def test_application_access_audit_invalidates_notification_summary(self):
        from app.core.realtime import prepare_changes
        from app.db.models import User
        from app.modules.access.audit import record

        async with self.sessions() as db:
            user = await db.get(User, "alice")
            record(db, user, user, "application_access_updated", {})
            await prepare_changes(db)
            self.assertGreater((await read_versions(db, "alice"))["notifications"], 0)

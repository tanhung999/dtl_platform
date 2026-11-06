"""Local protocol, retry and concurrency contracts; never call company services."""

from tests.support.api_case import ApiTestCase
import json
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from sqlalchemy import select, func, text

from app.db.applications import UserApplicationAccess, ApplicationPolicyOwnership
from app.db.applications import ApplicationProvisioningPolicy
from app.db.notifications import (
    Notification,
    ExternalNotificationState,
    NotificationReadOutbox,
)
from app.modules.notifications import source_bridge as bridge
from tests.support.notification_fixtures import grants


class SourceBridgeTests(ApiTestCase):
    async def test_first_import_preserves_foreign_key_insert_order(self):
        async with self.engine.begin() as conn:
            await conn.execute(text("PRAGMA foreign_keys=ON"))
        row = await self.merge([self.item("fk-first"), self.item("fk-second")])
        self.assertIsNotNone(row)
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(
                    select(func.count()).select_from(ExternalNotificationState)
                ),
                2,
            )
        await self.merge([self.item("fk-first"), self.item("fk-second")])
        self.assertEqual(await self.summary(), 2)

    async def test_background_selection_excludes_pending_unlink_and_carries_current_asset_policy(
        self,
    ):
        async with self.sessions() as db:
            bindings = await bridge.eligible_bindings(
                db, ["workflows", "itam", "bookingreports"]
            )
            self.assertEqual(len(bindings), 6)
            asset = next(
                row
                for row in bindings
                if row["source"] == "itam" and row["user_id"] == "alice"
            )
            self.assertEqual(bridge.source_payload(asset)["permission_keys"], [])
            db.add(
                ApplicationProvisioningPolicy(
                    user_id="alice",
                    application_key="workflows",
                    unlink_operation_id="pending-unlink",
                )
            )
            await db.commit()
            bindings = await bridge.eligible_bindings(db, ["workflows"])
            self.assertEqual([row["user_id"] for row in bindings], ["bob"])

    async def test_source_rejected_link_hides_history_without_deleting_it(self):
        row = await self.merge([self.item()])
        async with self.sessions() as db:
            await bridge.hide_rejected_binding(db, self.binding)
            await bridge.commit(db)
        self.assertEqual(await self.summary(), 0)
        async with self.sessions() as db:
            self.assertIsNotNone(await db.get(Notification, row.id))

    async def test_grant_edited_while_network_is_in_flight_cannot_import_stale_permissions(
        self,
    ):
        async with self.sessions() as db:
            binding = next(
                row
                for row in await bridge.eligible_bindings(db, ["workflows"])
                if row["user_id"] == "alice"
            )
            grant = await db.get(UserApplicationAccess, ("alice", "workflows"))
            grant.permission_overrides = {"test": False}
            await db.commit()
        async with self.sessions() as db:
            with self.assertRaises(HTTPException):
                await bridge.merge_feed(
                    db, binding, {"items": [self.item()], "visible_known_ids": []}, []
                )

    async def test_background_http_rejects_oversized_or_non_object_responses(self):
        for content in (b"x" * 1048577, b"[]"):
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(
                    lambda request: httpx.Response(200, content=content)
                )
            ) as client:
                with self.assertRaises(ValueError):
                    await bridge.request_source(
                        client,
                        self.config,
                        "workflows",
                        "feed",
                        bridge.binding_payload(self.binding),
                    )

    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            await grants(db, linked=True)
            await db.commit()
        self.binding = {
            "source": "workflows",
            "user_id": "alice",
            "recipient_subject": "alice-subject",
            "external_user_id": "alice-external",
            "link_operation_id": "alice-workflows-link",
        }
        self.config = (
            "http://source.test/api/integrations/platform/notification-sync",
            "test-secret-" + "x" * 40,
        )

    def item(self, identity="one", read=False, version=0, **extra):
        return {
            "external_id": identity,
            "title": "Notification",
            "body": "Safe saved text",
            "kind": "info",
            "action_path": "/documents",
            "occurred_at": "2026-11-01T09:00:00+00:00",
            "read": read,
            "read_version": version,
            **extra,
        }

    async def merge(self, items, known=(), visible=None):
        async with self.sessions() as db:
            await bridge.merge_feed(
                db,
                self.binding,
                {
                    "items": items,
                    "visible_known_ids": list(known) if visible is None else visible,
                },
                list(known),
            )
            await bridge.commit(db)
        async with self.sessions() as db:
            return await db.scalar(
                select(Notification)
                .where(Notification.source == "workflows")
                .order_by(Notification.id)
            )

    async def summary(self):
        return (await self.request("GET", "/api/notifications/summary"))[1][
            "unread_count"
        ]

    async def test_retries_do_not_duplicate_or_rewrite_read_state_or_saved_content(
        self,
    ):
        row = await self.merge([self.item()])
        self.assertEqual(await self.summary(), 1)
        await self.request(
            "PATCH", "/api/notifications/" + row.id, payload={"read": True}
        )
        await self.merge([self.item(title="Changed dynamic alert")], ["one"])
        self.assertEqual(await self.summary(), 0)
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(select(func.count()).select_from(Notification)), 1
            )
            self.assertEqual((await db.get(Notification, row.id)).title, "Notification")
            self.assertEqual(
                (await db.get(NotificationReadOutbox, row.id)).acknowledged_revision, 0
            )

    async def test_source_changes_are_versioned_and_do_not_echo_to_source(self):
        row = await self.merge([self.item()])
        await self.merge([self.item(read=True, version=1)], ["one"])
        self.assertEqual(await self.summary(), 0)
        await self.merge([self.item(read=False, version=2)], ["one"])
        self.assertEqual(await self.summary(), 1)
        await self.merge([self.item(read=True, version=1)], ["one"])
        self.assertEqual(await self.summary(), 1)
        async with self.sessions() as db:
            self.assertIsNone(await db.get(NotificationReadOutbox, row.id))

    async def test_network_outage_retains_outbox_then_recovers_both_directions(self):
        source = {"read": False, "version": 0, "offline": False}

        def transport(request):
            data = json.loads(request.content)
            self.assertNotIn("user_id", data)
            self.assertTrue(
                request.headers["X-Notification-Signature"].startswith("sha256=")
            )
            if source["offline"]:
                raise httpx.ConnectError("isolated test outage", request=request)
            if request.url.path.endswith("/read"):
                if source["read"] != data["read"]:
                    source["read"] = data["read"]
                    source["version"] += 1
                return httpx.Response(
                    200,
                    json={
                        "external_id": "one",
                        "read": source["read"],
                        "read_version": source["version"],
                    },
                )
            return httpx.Response(
                200,
                json={
                    "items": [
                        self.item(read=source["read"], version=source["version"])
                    ],
                    "visible_known_ids": data["known_ids"],
                    "next_cursor": "one",
                },
            )

        with patch.object(bridge, "async_session_maker", self.sessions):
            async with httpx.AsyncClient(
                transport=httpx.MockTransport(transport)
            ) as client:
                await bridge.sync_binding(client, self.config, self.binding)
                async with self.sessions() as db:
                    row = await db.scalar(
                        select(Notification).where(Notification.source == "workflows")
                    )
                await self.request(
                    "PATCH", "/api/notifications/" + row.id, payload={"read": True}
                )
                source["offline"] = True
                with self.assertRaises(httpx.ConnectError):
                    await bridge.sync_binding(client, self.config, self.binding)
                async with self.sessions() as db:
                    pending = await db.get(NotificationReadOutbox, row.id)
                    self.assertGreater(pending.revision, pending.acknowledged_revision)
                source["offline"] = False
                await bridge.sync_binding(client, self.config, self.binding)
                self.assertTrue(source["read"])
                async with self.sessions() as db:
                    pending = await db.get(NotificationReadOutbox, row.id)
                    self.assertEqual(pending.revision, pending.acknowledged_revision)
                source.update(read=False, version=2)
                await bridge.sync_binding(client, self.config, self.binding)
                self.assertEqual(await self.summary(), 1)

    async def test_old_network_response_cannot_ack_or_overwrite_newer_platform_click(
        self,
    ):
        row = await self.merge([self.item()])
        await self.request(
            "PATCH", "/api/notifications/" + row.id, payload={"read": True}
        )
        await self.request(
            "PATCH", "/api/notifications/" + row.id, payload={"read": False}
        )
        async with self.sessions() as db:
            await bridge.apply_read_result(
                db,
                self.binding,
                row.id,
                1,
                {"external_id": "one", "read": True, "read_version": 1},
            )
            await bridge.commit(db)
        self.assertEqual(await self.summary(), 1)
        async with self.sessions() as db:
            pending = await db.get(NotificationReadOutbox, row.id)
            self.assertEqual(pending.revision, 2)
            self.assertEqual(pending.acknowledged_revision, 0)

    async def test_conflict_reconciles_latest_source_without_resending_stale_change(
        self,
    ):
        row = await self.merge([self.item()])
        await self.request(
            "PATCH", "/api/notifications/" + row.id, payload={"read": True}
        )
        async with self.sessions() as db:
            await bridge.apply_read_result(
                db,
                self.binding,
                row.id,
                1,
                {
                    "external_id": "one",
                    "read": False,
                    "read_version": 2,
                    "conflict": True,
                },
            )
            await bridge.commit(db)
        self.assertEqual(await self.summary(), 1)
        async with self.sessions() as db:
            pending = await db.get(NotificationReadOutbox, row.id)
            self.assertEqual(pending.revision, pending.acknowledged_revision)

    async def test_permission_removed_during_fetch_cannot_import_and_old_link_is_hidden(
        self,
    ):
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ("alice", "workflows"))
            grant.enabled = False
            await db.commit()
        with self.assertRaises(HTTPException):
            await self.merge([self.item()])
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ("alice", "workflows"))
            grant.enabled = True
            await db.commit()
        row = await self.merge([self.item()])
        async with self.sessions() as db:
            link = await db.get(ApplicationPolicyOwnership, ("alice", "workflows"))
            link.operation_id = "new-link"
            await db.commit()
        self.assertEqual(await self.summary(), 0)
        with self.assertRaises(HTTPException):
            await self.merge([self.item(read=True, version=1)])
        async with self.sessions() as db:
            self.assertIsNotNone(await db.get(Notification, row.id))

    async def test_retired_or_no_longer_visible_source_alert_is_hidden_and_can_reappear(
        self,
    ):
        row = await self.merge([self.item()])
        await self.merge([], ["one"], visible=[])
        self.assertEqual(await self.summary(), 0)
        await self.merge([self.item()], ["one"])
        self.assertEqual(await self.summary(), 1)
        async with self.sessions() as db:
            self.assertIsNotNone(await db.get(Notification, row.id))

    async def test_read_result_404_hides_delivery_without_deleting_history(self):
        row = await self.merge([self.item()])
        await self.request(
            "PATCH", "/api/notifications/" + row.id, payload={"read": True}
        )
        async with self.sessions() as db:
            await bridge.apply_read_result(
                db, self.binding, row.id, 1, {"missing": True}
            )
            await bridge.commit(db)
        async with self.sessions() as db:
            self.assertFalse(
                (await db.get(ExternalNotificationState, row.id)).source_visible
            )
            self.assertEqual(
                (await db.get(NotificationReadOutbox, row.id)).acknowledged_revision, 1
            )

    async def test_backlog_pages_and_known_state_do_not_duplicate_and_rotate_bounded_reads(
        self,
    ):
        with patch.object(bridge, "async_session_maker", self.sessions):
            seen = []

            def transport(request):
                data = json.loads(request.content)
                seen.append(data)
                page = 0 if not data["cursor"] else int(data["cursor"])
                return httpx.Response(
                    200,
                    json={
                        "items": [self.item(str(i)) for i in range(page, page + 100)],
                        "visible_known_ids": data["known_ids"],
                        "next_cursor": str(page + 100),
                    },
                )

            async with httpx.AsyncClient(
                transport=httpx.MockTransport(transport)
            ) as client:
                cursor, offset = await bridge.sync_binding(
                    client, self.config, self.binding
                )
                cursor, offset = await bridge.sync_binding(
                    client, self.config, self.binding, cursor, offset
                )
                self.assertEqual(cursor, "200")
                self.assertLessEqual(len(seen[-1]["known_ids"]), 100)
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(select(func.count()).select_from(Notification)), 200
            )

    async def test_malformed_snapshot_cannot_create_partial_batch_or_external_redirect(
        self,
    ):
        for row in (
            self.item(action_path="//other.example"),
            self.item(version=-1),
            self.item(read="false"),
        ):
            with self.assertRaises((ValueError, TypeError)):
                await self.merge([self.item("good"), row])
        async with self.sessions() as db:
            self.assertEqual(
                await db.scalar(select(func.count()).select_from(Notification)), 0
            )

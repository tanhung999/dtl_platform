from datetime import timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import delete, select
from app.db.models import User, utcnow
from app.db.applications import (
    ApplicationPolicyOwnership,
    ApplicationSecurityEvent,
    UserApplicationAccess,
)
from app.modules.applications import security_events
from tests.integration.test_policy_handover import PolicyHandoverTests


class LinkedAccountSecurityTests(PolicyHandoverTests):
    async def test_linking_without_enabled_access_keeps_access_disabled(self):
        for app in ("workflows", "itam", "bookingreports"):
            async with self.sessions() as db:
                await db.execute(
                    delete(UserApplicationAccess).where(
                        UserApplicationAccess.user_id == "bob",
                        UserApplicationAccess.application_key == app,
                    )
                )
                await db.commit()
            # Candidate selection creates only a disabled grant with a stable revision.
            with patch(
                "app.modules.applications.policy_linking.remote",
                new=AsyncMock(return_value={"items": []}),
            ):
                status, result = await self.request(
                    "GET",
                    f"/api/admin/applications/{app}/users/bob/policy-link/candidates",
                )
            self.assertEqual(status, 200, result)
            async with self.sessions() as db:
                self.assertFalse(
                    (await db.get(UserApplicationAccess, ("bob", app))).enabled
                )
            payload = await self.payload(app)
            status, result, _ = await self.confirm(app, payload)
            self.assertEqual(status, 200, result)
            async with self.sessions() as db:
                self.assertFalse(
                    (await db.get(UserApplicationAccess, ("bob", app))).enabled
                )
                self.assertIsNotNone(
                    await db.get(ApplicationPolicyOwnership, ("bob", app))
                )

    async def event(self):
        operation = str(uuid4())
        async with self.sessions() as db:
            db.add(
                ApplicationPolicyOwnership(
                    user_id="bob",
                    application_key="workflows",
                    external_user_id=str(uuid4()),
                    operation_id=operation,
                    role_keys=["basic"],
                    imported_snapshot={},
                )
            )
            user = await db.get(User, "bob")
            await security_events.enqueue_revocation(db, user)
            self.assertEqual(user.external_session_version, 1)
            await db.commit()
            return await db.scalar(select(ApplicationSecurityEvent.id))

    async def test_revocation_is_durable_retries_and_is_idempotent(self):
        identifier = await self.event()
        with (
            patch.object(security_events, "async_session_maker", self.sessions),
            patch(
                "app.modules.applications.policy_linking.remote",
                new=AsyncMock(side_effect=TimeoutError),
            ) as remote,
        ):
            await security_events.deliver(identifier)
            self.assertEqual(remote.await_count, 1)
        async with self.sessions() as db:
            event = await db.get(ApplicationSecurityEvent, identifier)
            self.assertEqual(event.attempts, 1)
            self.assertIsNone(event.processed_at)
            event.available_at = utcnow() - timedelta(seconds=1)
            await db.commit()
        with (
            patch.object(security_events, "async_session_maker", self.sessions),
            patch(
                "app.modules.applications.policy_linking.remote",
                new=AsyncMock(return_value={"revoked": 1}),
            ) as remote,
        ):
            await security_events.deliver(identifier)
            await security_events.deliver(identifier)
            self.assertEqual(remote.await_count, 1)
            self.assertEqual(remote.await_args.kwargs["body"]["session_version"], 1)
        async with self.sessions() as db:
            self.assertIsNotNone(
                (await db.get(ApplicationSecurityEvent, identifier)).processed_at
            )

    async def test_obsolete_event_cannot_revoke_a_different_binding(self):
        identifier = await self.event()
        async with self.sessions() as db:
            owner = await db.get(ApplicationPolicyOwnership, ("bob", "workflows"))
            owner.operation_id = str(uuid4())
            await db.commit()
        with (
            patch.object(security_events, "async_session_maker", self.sessions),
            patch(
                "app.modules.applications.policy_linking.remote", new=AsyncMock()
            ) as remote,
        ):
            await security_events.deliver(identifier)
            remote.assert_not_awaited()

    async def test_transaction_rollback_preserves_generation_and_leaves_no_event(self):
        async with self.sessions() as db:
            await security_events.enqueue_revocation(db, await db.get(User, "bob"))
            await db.rollback()
        async with self.sessions() as db:
            self.assertEqual((await db.get(User, "bob")).external_session_version, 0)
            self.assertIsNone(await db.scalar(select(ApplicationSecurityEvent.id)))

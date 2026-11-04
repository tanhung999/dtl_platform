from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from tests.integration.test_policy_handover import PolicyHandoverTests
from app.core.config import settings
from app.db.applications import (
    ApplicationProvisioningPolicy,
    ApplicationPolicyOwnership,
    UserApplicationAccess,
)
from app.db.models import Bookmark
from app.db.migrations.per_user_provisioning import migrate_per_user_provisioning
from app.modules.applications import provisioning as module


class ProvisioningTests(PolicyHandoverTests):
    async def test_definitive_unlink_rejection_allows_selecting_fresh_revision(self):
        linked = {'state': 'linked', 'account': {'id': '123'}, 'snapshot': {'revision': 'c' * 64}}
        with patch.object(module, 'remote', AsyncMock(side_effect=[linked, HTTPException(409, 'rights changed')])):
            code, _ = await self.request('POST', self.base() + '/unlink', payload={'operation_id': str(uuid4()),
                'external_user_id': '123', 'expected_revision': 'c' * 64, 'expected_version': 0})
        self.assertEqual(code, 409)
        async with self.sessions() as db:
            policy = await db.get(ApplicationProvisioningPolicy, ('bob', 'workflows'))
            self.assertIsNone(policy.unlink_operation_id)
            self.assertTrue((await db.get(UserApplicationAccess, ('bob', 'workflows'))).enabled)
    async def test_late_enable_ack_does_not_replace_newer_off_intent(self):
        async def remote(application, method, path, **kwargs):
            generation = kwargs['body']['generation']
            if generation == 1:
                code, value = await self.request('PUT', self.base(), payload={'enabled': False, 'expected_version': 1})
                self.assertEqual(code, 200, value)
            return self.unlinked(generation=generation)
        with patch.object(module, 'remote', remote):
            code, _ = await self.request('PUT', self.base(), payload={'enabled': True, 'expected_version': 0})
        self.assertEqual(code, 409)
        async with self.sessions() as db:
            policy = await db.get(ApplicationProvisioningPolicy, ('bob', 'workflows'))
            self.assertFalse(policy.enabled); self.assertEqual(policy.generation, 2); self.assertIsNone(policy.pending_enabled)

    async def test_unlink_timeout_blocks_sso_and_reload_exposes_same_retry(self):
        linked = {'state': 'linked', 'account': {'id': '123', 'identity_subject': self.subject},
            'snapshot': {'revision': 'c' * 64}}
        operation = str(uuid4())
        with patch.object(module, 'remote', AsyncMock(side_effect=[linked, HTTPException(503, 'lost response')])):
            code, _ = await self.request('POST', self.base() + '/unlink', payload={'operation_id': operation,
                'external_user_id': '123', 'expected_revision': 'c' * 64, 'expected_version': 0})
        self.assertEqual(code, 503)
        with patch.object(settings, 'INTEGRATION_WORKFLOWS_SECRET', 'private'):
            code, value = await self.request('GET', f'/api/integrations/applications/workflows/subjects/{self.subject}',
                user=None, headers_extra={'X-DTL-Integration-Secret': 'private'})
        self.assertEqual(code, 200); self.assertFalse(value['allowed'])
        with patch.object(module, 'integration', return_value=('http://isolated', 'private')), patch.object(module, 'remote', AsyncMock(return_value=self.unlinked())):
            code, value = await self.request('GET', self.base())
        self.assertEqual(code, 200, value)
        self.assertEqual(value['pending_unlink'], {'operation_id': operation, 'external_user_id': '123', 'expected_revision': 'c' * 64})
        with patch.object(module, 'remote', AsyncMock(return_value={'operation_id': operation, 'external_user_id': '123'})):
            code, value = await self.request('POST', self.base() + '/unlink', payload={**value['pending_unlink'], 'expected_version': value['version']})
        self.assertEqual(code, 200, value)
    def base(self, app="workflows"):
        return f"/api/admin/applications/{app}/users/bob/provisioning"

    def unlinked(self, **extra):
        return {
            "state": "unlinked",
            "collision": False,
            "role_keys": ["basic", "extra"],
            "permission_keys": ["view", "write", "delete"],
            **extra,
        }

    async def toggle(self, enabled, version, result=None):
        remote = AsyncMock(return_value=result or self.unlinked(generation=version + 1))
        with patch.object(module, "remote", remote):
            response = await self.request(
                "PUT",
                self.base(),
                payload={"enabled": enabled, "expected_version": version},
            )
        return response, remote

    async def test_default_off_no_access_no_admin_and_per_app_isolation(self):
        with (
            patch.object(
                module, "integration", return_value=("http://isolated", "private")
            ),
            patch.object(module, "remote", AsyncMock(return_value=self.unlinked())),
        ):
            code, value = await self.request("GET", self.base())
            self.assertEqual(code, 200, value)
            self.assertFalse(value["enabled"])
            self.assertTrue(value["can_enable"])
        (code, value), _ = await self.toggle(True, 0, self.unlinked(generation=1))
        self.assertEqual(code, 200, value)
        self.assertTrue(value["enabled"])
        async with self.sessions() as db:
            self.assertIsNone(
                await db.get(ApplicationProvisioningPolicy, ("bob", "itam"))
            )
            grant = await db.get(UserApplicationAccess, ("bob", "itam"))
            grant.enabled = False
            await db.commit()
        remote = AsyncMock()
        with patch.object(module, "remote", remote):
            code, _ = await self.request(
                "PUT",
                self.base("itam"),
                payload={"enabled": True, "expected_version": 0},
            )
            self.assertEqual(code, 409)
            code, _ = await self.request(
                "PUT",
                self.base(),
                user="bob",
                payload={"enabled": False, "expected_version": 2},
            )
            self.assertEqual(code, 403)
            remote.assert_not_awaited()

    async def test_failed_remote_persists_intent_and_can_turn_off_after_reload(self):
        with patch.object(
            module, "remote", AsyncMock(side_effect=HTTPException(503, "unavailable"))
        ):
            code, _ = await self.request(
                "PUT", self.base(), payload={"enabled": True, "expected_version": 0}
            )
        self.assertEqual(code, 503)
        async with self.sessions() as db:
            policy = await db.get(ApplicationProvisioningPolicy, ("bob", "workflows"))
            self.assertTrue(policy.pending_enabled)
            self.assertEqual(policy.pending_generation, 1)
            self.assertFalse(policy.enabled)
        (code, value), remote = await self.toggle(False, 1, self.unlinked(generation=2))
        self.assertEqual(code, 200, value)
        self.assertFalse(value["enabled"])
        self.assertIsNone(value["pending_enabled"])
        self.assertEqual(remote.await_args.kwargs["body"]["generation"], 2)
        (code, _), _ = await self.toggle(True, 0)
        self.assertEqual(code, 409)

    async def test_collision_never_enables_and_creates_nothing(self):
        (code, value), _ = await self.toggle(
            True, 0, self.unlinked(generation=1, collision=True)
        )
        self.assertEqual(code, 200, value)
        self.assertFalse(value["enabled"])
        self.assertFalse(value["can_enable"])
        async with self.sessions() as db:
            self.assertIsNone(
                await db.get(ApplicationPolicyOwnership, ("bob", "workflows"))
            )

    async def test_create_replay_imports_actual_rights_and_unlink_preserves_rights(
        self,
    ):
        (code, value), _ = await self.toggle(True, 0, self.unlinked(generation=1))
        self.assertEqual(code, 200, value)
        operation = module.operation_for("bob", "workflows", self.subject, 1)
        snapshot = {
            "account": {"id": "123", "identity_subject": self.subject},
            "role_keys": ["basic"],
            "permission_keys": ["view"],
            "project_names": [],
            "catalog_permission_keys": ["view", "write", "delete"],
            "revision": "b" * 64,
        }
        linked = {
            "state": "linked",
            "account": snapshot["account"],
            "snapshot": snapshot,
            "provisioned_operation_id": operation,
        }
        remote = AsyncMock(side_effect=[self.unlinked(), linked])
        path = f"/api/integrations/applications/workflows/subjects/{self.subject}/provision"
        with (
            patch.object(settings, "INTEGRATION_WORKFLOWS_SECRET", "private"),
            patch.object(module, "remote", remote),
        ):
            for _ in range(2):
                code, value = await self.request(
                    "POST",
                    path,
                    user=None,
                    headers_extra={"X-DTL-Integration-Secret": "private"},
                )
                self.assertEqual(code, 200, value)
                self.assertEqual(value["entitlement"]["policy_import_id"], operation)
        self.assertEqual(
            remote.await_count, 2
        )  # The replay uses central ownership, never creates twice.
        async with self.sessions() as db:
            policy = await db.get(ApplicationProvisioningPolicy, ("bob", "workflows"))
            version = policy.version
            self.assertFalse(policy.enabled)
        unlink_id = str(uuid4())
        with patch.object(
            module,
            "remote",
            AsyncMock(
                side_effect=[
                    linked,
                    {"operation_id": unlink_id, "external_user_id": "123"},
                ]
            ),
        ):
            code, value = await self.request(
                "POST",
                self.base() + "/unlink",
                payload={
                    "operation_id": unlink_id,
                    "external_user_id": "123",
                    "expected_revision": snapshot["revision"],
                    "expected_version": version,
                },
            )
        self.assertEqual(code, 200, value)
        async with self.sessions() as db:
            self.assertIsNone(
                await db.get(ApplicationPolicyOwnership, ("bob", "workflows"))
            )
            grant = await db.get(UserApplicationAccess, ("bob", "workflows"))
            self.assertFalse(grant.enabled)
            self.assertTrue(grant.permission_overrides["view"])
            self.assertFalse(
                (
                    await db.get(ApplicationProvisioningPolicy, ("bob", "workflows"))
                ).enabled
            )

    async def test_only_original_global_bookmarks_are_retired(self):
        async with self.sessions() as db:
            db.add_all(
                [
                    Bookmark(
                        id="sample",
                        title="Webmail Đông Tây Land",
                        url="https://mail.dongtayland.vn/",
                        category="Hệ thống nội bộ",
                        is_global=True,
                    ),
                    Bookmark(
                        id="personal",
                        title="Webmail Đông Tây Land",
                        url="https://mail.dongtayland.vn/",
                        category="Hệ thống nội bộ",
                        is_global=False,
                        user_id="alice",
                    ),
                    Bookmark(
                        id="custom",
                        title="My link",
                        url="https://example.test",
                        is_global=False,
                        user_id="alice",
                    ),
                ]
            )
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_per_user_provisioning(conn)
        async with self.sessions() as db:
            self.assertEqual(
                set((await db.scalars(select(Bookmark.id))).all()),
                {"personal", "custom"},
            )
        code, value = await self.request("GET", "/api/bookmarks", user="bob")
        self.assertEqual(code, 200, value)
        self.assertEqual(value, [])

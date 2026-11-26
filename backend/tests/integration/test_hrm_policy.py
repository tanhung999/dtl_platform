"""Exercise both HRM policy writers against one versioned assignment."""
from unittest.mock import patch
from uuid import uuid4

from sqlalchemy import select

from tests.support.api_case import ApiTestCase
from app.core.config import settings
from app.db.access import AccessAuditLog, AccessPermission, AccessRole, RolePermission, UserRole
from app.db.applications import Application, ApplicationPermission, ApplicationRole, UserApplicationAccess
from app.db.models import User
from app.modules.access.service import MANAGE


class HrmPolicyTests(ApiTestCase):
    async def test_both_editors_share_version_and_audit(self):
        async with self.sessions() as db:
            for name in ("alice", "bob"):
                user = await db.get(User, name)
                user.identity_subject = f"kc-{name}"
            db.add_all([
                AccessRole(id="app-admin", name="Application admin"),
                AccessPermission(code=MANAGE, name="Manage applications"),
                Application(key="hrm", display_name="DT HRM", launch_url="http://localhost:18088", permission_prefix="hrm"),
                ApplicationRole(id="hrm:employee", application_key="hrm", key="employee", display_name="Employee"),
                ApplicationRole(id="hrm:admin", application_key="hrm", key="admin", display_name="Admin"),
                ApplicationPermission(id="hrm:hrm.access.manage", application_key="hrm", code="hrm.access.manage", display_name="Manage access"),
                ApplicationPermission(id="hrm:hrm.self.service", application_key="hrm", code="hrm.self.service", display_name="Self service"),
            ])
            await db.flush()
            db.add_all([
                RolePermission(role_id="app-admin", permission_code=MANAGE),
                UserRole(user_id="alice", role_id="app-admin"),
                UserApplicationAccess(user_id="alice", application_key="hrm", enabled=True),
                UserApplicationAccess(user_id="bob", application_key="hrm", enabled=True),
            ])
            await db.commit()
        self.addCleanup(setattr, settings, "INTEGRATION_HRM_SECRET", settings.INTEGRATION_HRM_SECRET)
        settings.INTEGRATION_HRM_SECRET = "test-hrm-integration-secret"
        header = {"X-DTL-Integration-Secret": settings.INTEGRATION_HRM_SECRET}
        edit_url = "/api/integrations/applications/hrm/subjects/kc-bob/policy"

        async def current(name):
            status, data = await self.request("GET", f"/api/admin/applications/users/{name}/access")
            self.assertEqual(status, 200, data)
            return next(item for item in data if item["key"] == "hrm")

        async def set_policy(name, roles, permissions):
            state = await current(name)
            status, data = await self.request("PUT", f"/api/admin/applications/hrm/users/{name}", payload={
                "enabled": True, "expected_updated_at": state["access_updated_at"],
                "expected_policy_version": state["policy_version"], "role_keys": roles,
                "permission_keys": permissions,
            })
            self.assertEqual(status, 200, data)
            self.assertEqual(data["access_updated_at"], state["access_updated_at"])
            return data

        with patch("app.modules.applications.policy_notifications.notify_hrm_policy_changed"):
            await set_policy("alice", ["admin"], ["hrm.access.manage"])
            stale = await current("bob")
            updated = await set_policy("bob", ["employee"], ["hrm.self.service"])
            body = {"actor_subject": "kc-alice", "expected_version": stale["policy_version"],
                    "grant_revision": stale["access_updated_at"], "request_id": str(uuid4()),
                    "role_keys": ["employee"], "permission_keys": []}
            status, _ = await self.request("PUT", edit_url, user=None, payload=body, headers_extra=header)
            self.assertEqual(status, 409)
            body.update(expected_version=updated["policy_version"], request_id=str(uuid4()))
            status, first = await self.request("PUT", edit_url, user=None, payload=body, headers_extra=header)
            self.assertEqual(status, 200, first)
            status, retry = await self.request("PUT", edit_url, user=None, payload=body, headers_extra=header)
            self.assertEqual(status, 200, retry)
            self.assertEqual(first, retry)
            _, entitlement = await self.request("GET", "/api/integrations/applications/hrm/subjects/kc-bob",
                                                user=None, headers_extra=header)
            self.assertTrue(entitlement["allowed"])
            self.assertEqual(entitlement["role_keys"], ["employee"])
            self.assertEqual(entitlement["permission_keys"], [])
            self.assertEqual((await current("bob"))["policy_version"], updated["policy_version"] + 1)
            async with self.sessions() as db:
                rows = (await db.scalars(select(AccessAuditLog).where(
                    AccessAuditLog.action == "application_hrm_policy_updated",
                    AccessAuditLog.subject_id == "bob",
                ))).all()
                self.assertCountEqual([(row.actor_id, row.changes["origin"]) for row in rows],
                                      [("alice", "platform"), ("alice", "hrm")])
            await set_policy("alice", ["admin"], [])
            body.update(expected_version=first["policy_version"], request_id=str(uuid4()))
            status, _ = await self.request("PUT", edit_url, user=None, payload=body, headers_extra=header)
            self.assertEqual(status, 403)

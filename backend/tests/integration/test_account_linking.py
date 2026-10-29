from unittest.mock import AsyncMock, patch
from uuid import uuid4

import httpx
from sqlalchemy import func, select

from tests.support.api_case import ApiTestCase
from app.core.config import settings
from app.db.access import AccessAuditLog, AccessPermission, AccessRole, RolePermission, UserRole
from app.db.applications import Application, ApplicationPermission, ApplicationRole, ApplicationRolePermission, UserApplicationAccess
from app.db.models import User
from app.modules.access.service import APPLICATIONS_MANAGE
from app.modules.applications import account_linking as linking


class AccountLinkingTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.url_patch = patch.object(settings, 'WORKFLOWS_ACCOUNT_LINKING_URL', 'http://127.0.0.1:18082/api/integrations/platform/account-links')
        self.secret_patch = patch.object(settings, 'WORKFLOWS_ACCOUNT_LINKING_SECRET', 'local-test-linking-credential-123456789')
        self.url_patch.start(); self.secret_patch.start()
        self.subject = str(uuid4())
        self.external_id = str(uuid4())
        self.account = {'id': self.external_id, 'username': 'bob-workflow', 'identity_subject': self.subject,
                        'full_name': 'Bob Workflow', 'is_active': True, 'updated_at': '2026-10-29T00:00:00Z'}
        async with self.sessions() as db:
            db.add_all([AccessRole(id='app-manager', name='Application manager'),
                        AccessPermission(code=APPLICATIONS_MANAGE, name='Manage applications'),
                        Application(key='workflows', display_name='DT Workflow', launch_url='http://localhost:18082', permission_prefix='workflow')])
            await db.flush()
            db.add_all([UserRole(user_id='alice', role_id='app-manager'), RolePermission(role_id='app-manager', permission_code=APPLICATIONS_MANAGE),
                        ApplicationRole(id='workflows:STAFF', application_key='workflows', key='STAFF', display_name='Nhân viên'),
                        ApplicationPermission(id='workflows:view', application_key='workflows', code='document.view', display_name='Xem hồ sơ')])
            await db.flush()
            db.add_all([ApplicationRolePermission(role_id='workflows:STAFF', permission_id='workflows:view'),
                        UserApplicationAccess(user_id='bob', application_key='workflows', enabled=True, role_id='workflows:STAFF')])
            target = await db.get(User, 'bob'); target.identity_subject = self.subject
            await db.commit()
        self.base = '/api/admin/applications/workflows/users/bob/account-link'

    async def asyncTearDown(self):
        self.secret_patch.stop(); self.url_patch.stop()
        await super().asyncTearDown()

    def remote_state(self):
        return {'accounts': [], 'roles': [{'key': 'STAFF', 'name': 'Staff'}], 'permission_keys': ['document.view'], 'history': []}

    async def payload(self):
        with patch.object(linking, 'workflow_request', AsyncMock(return_value=self.remote_state())):
            status, value = await self.request('GET', self.base)
        self.assertEqual(status, 200, value)
        return {'operation_id': str(uuid4()), 'workflow_user_id': self.external_id, 'expected_subject': None,
                'expected_updated_at': '2026-10-29T00:00:00Z', 'expected_platform_subject': self.subject,
                'expected_grant_updated_at': value['grant_updated_at']}

    async def test_requires_admin_permission_and_no_secret_leak(self):
        remote = AsyncMock()
        with patch.object(linking, 'workflow_request', remote):
            self.assertEqual((await self.request('GET', self.base, user='bob'))[0], 403)
            self.assertEqual((await self.request('GET', self.base, user=None))[0], 401)
        remote.assert_not_awaited()
        with patch.object(settings, 'WORKFLOWS_ACCOUNT_LINKING_URL', ''):
            status, value = await self.request('GET', self.base)
        self.assertEqual(status, 200)
        self.assertFalse(value['configured'])
        self.assertNotIn(settings.WORKFLOWS_ACCOUNT_LINKING_SECRET, str(value))

    async def test_inactive_or_ungranted_targets_never_contact_workflow(self):
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ('bob', 'workflows')); grant.enabled = False
            await db.commit()
        remote = AsyncMock()
        with patch.object(linking, 'workflow_request', remote):
            status, state = await self.request('GET', self.base)
            self.assertEqual(status, 200); self.assertIn('cấp quyền', state['blocked_reason'])
            self.assertEqual((await self.request('GET', self.base + '/candidates'))[0], 409)
        remote.assert_not_awaited()

    async def test_link_uses_server_identity_and_records_only_one_audit_on_retry(self):
        payload = await self.payload()
        remote = AsyncMock(return_value={'account': self.account, 'changed': True, 'operation_id': payload['operation_id'], 'revoked_sessions': 2})
        with patch.object(linking, 'workflow_request', remote):
            for _ in range(2):
                status, result = await self.request('POST', self.base, payload=payload)
                self.assertEqual(status, 200, result)
        sent = remote.await_args.kwargs['body']
        self.assertEqual(sent['identity_subject'], self.subject)
        self.assertEqual(sent['actor_id'], 'alice')
        self.assertEqual(sent['permission_keys'], ['document.view'])
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(AccessAuditLog).where(AccessAuditLog.action == 'application_account_linked')), 1)
            grant = await db.get(UserApplicationAccess, ('bob', 'workflows'))
            self.assertTrue(grant.enabled); self.assertEqual(grant.role_id, 'workflows:STAFF')

    async def test_rejects_stale_policy_and_identity_injection(self):
        payload = await self.payload()
        remote = AsyncMock()
        with patch.object(linking, 'workflow_request', remote):
            self.assertEqual((await self.request('POST', self.base, payload={**payload, 'identity_subject': 'override'}))[0], 422)
            self.assertEqual((await self.request('POST', self.base, payload={**payload, 'expected_platform_subject': 'stale'}))[0], 409)
            self.assertEqual((await self.request('POST', self.base, payload={**payload, 'expected_grant_updated_at': 'stale'}))[0], 409)
        remote.assert_not_awaited()

    async def test_remote_conflicts_and_unconfirmed_results_do_not_create_audit(self):
        payload = await self.payload()
        with patch.object(linking, 'workflow_request', AsyncMock(return_value={'account': {**self.account, 'id': str(uuid4())}, 'operation_id': payload['operation_id']})):
            self.assertEqual((await self.request('POST', self.base, payload=payload))[0], 502)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(AccessAuditLog)), 0)

    async def test_http_client_does_not_follow_redirects_and_sanitizes_auth_errors(self):
        original = httpx.AsyncClient
        for code in (302, 401, 500):
            calls = []
            def handle(request):
                calls.append(request)
                return httpx.Response(code, headers={'location': 'http://do-not-follow.invalid'}, text='private upstream error')
            def client(**kwargs):
                self.assertFalse(kwargs['trust_env']); self.assertFalse(kwargs['follow_redirects'])
                return original(transport=httpx.MockTransport(handle), **kwargs)
            with patch.object(linking.httpx, 'AsyncClient', client):
                status, value = await self.request('GET', self.base)
            self.assertEqual(status, 503)
            self.assertEqual(len(calls), 1)
            self.assertNotIn('private upstream', str(value))

    async def test_timeout_retry_reuses_identical_operation_and_target(self):
        payload = await self.payload(); original = httpx.AsyncClient; bodies = []
        def handle(request):
            import json
            bodies.append(json.loads(request.content))
            if len(bodies) == 1:
                raise httpx.ReadTimeout('Lost response after commit')
            return httpx.Response(200, json={'account': self.account, 'operation_id': payload['operation_id'], 'changed': False})
        with patch.object(linking.httpx, 'AsyncClient', lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs)):
            status, value = await self.request('POST', self.base, payload=payload)
        self.assertEqual(status, 200, value); self.assertEqual(len(bodies), 2); self.assertEqual(bodies[0], bodies[1])

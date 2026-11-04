from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy import select, func

from tests.support.api_case import ApiTestCase
from app.db.models import User
from app.db.access import AccessRole, AccessPermission, RolePermission, UserRole, AccessAuditLog
from app.db.applications import Application, ApplicationRole, ApplicationPermission, ApplicationRolePermission, UserApplicationAccess, ApplicationPolicyOwnership
from app.modules.access.service import MANAGE
from app.modules.applications import policy_linking
from app.core.config import settings


class PolicyHandoverTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.subject = str(uuid4())
        async with self.sessions() as db:
            db.add_all([AccessRole(id='admin', name='Admin'), AccessPermission(code=MANAGE, name='Admin')])
            await db.flush()
            db.add_all([UserRole(user_id='alice', role_id='admin'), RolePermission(role_id='admin', permission_code=MANAGE)])
            (await db.get(User, 'bob')).identity_subject = self.subject
            for app in ('workflows', 'itam', 'bookingreports'):
                db.add(Application(key=app, display_name=app, launch_url='http://localhost', permission_prefix=app))
                await db.flush()
                for key in ('basic', 'extra'):
                    db.add(ApplicationRole(id=f'{app}:{key}', application_key=app, key=key, display_name=key))
                for code in ('view', 'write', 'delete'):
                    db.add(ApplicationPermission(id=f'{app}:{code}', application_key=app, code=code, display_name=code))
                await db.flush()
                db.add(ApplicationRolePermission(role_id=f'{app}:basic', permission_id=f'{app}:view'))
                db.add(UserApplicationAccess(user_id='bob', application_key=app, enabled=True, role_id=f'{app}:basic'))
            await db.commit()

    async def payload(self, app):
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ('bob', app))
            return {'operation_id': str(uuid4()), 'external_user_id': '123', 'expected_revision': 'a' * 64,
                'expected_platform_subject': self.subject, 'expected_grant_updated_at': grant.updated_at.isoformat()}

    def snapshot(self):
        return {'account': {'id': '123'}, 'role_keys': ['basic', 'extra'], 'permission_keys': ['write'],
                'project_names': ['Project A'], 'catalog_permission_keys': ['view', 'write', 'delete'], 'revision': 'a' * 64}

    async def confirm(self, app, payload, snapshot=None, user='alice'):
        remote = AsyncMock(return_value={'operation_id': payload['operation_id'], 'identity_subject': self.subject, 'snapshot': snapshot or self.snapshot()})
        with patch.object(policy_linking, 'remote', remote):
            status, value = await self.request('POST', f'/api/admin/applications/{app}/users/bob/policy-link', payload=payload, user=user)
        return status, value, remote

    async def test_all_three_apps_import_actual_rights_not_basic_role_defaults(self):
        for app in ('workflows', 'itam', 'bookingreports'):
            payload = await self.payload(app)
            status, value, remote = await self.confirm(app, payload)
            self.assertEqual(status, 200, value)
            self.assertNotIn('permission_keys', remote.await_args.kwargs['body'])
            async with self.sessions() as db:
                owner = await db.get(ApplicationPolicyOwnership, ('bob', app))
                self.assertEqual(owner.role_keys, ['basic', 'extra'])
                grant = await db.get(UserApplicationAccess, ('bob', app))
                self.assertEqual(grant.permission_overrides, {'delete': False, 'view': False, 'write': True})
                self.assertEqual(grant.project_names, ['Project A'])
            # Entitlement and UI must agree about both role membership and actual rights.
            from app.modules.applications.router import _access_view
            async with self.sessions() as db:
                view = await _access_view(db, await db.get(Application, app), await db.get(UserApplicationAccess, ('bob', app)))
                self.assertEqual(view.permission_keys, ['write'])
                self.assertEqual(view.role_keys, ['basic', 'extra'])
                self.assertEqual(view.policy_import_id, payload['operation_id'])
            secret_field = {'workflows': 'INTEGRATION_WORKFLOWS_SECRET', 'itam': 'INTEGRATION_ITAM_SECRET', 'bookingreports': 'INTEGRATION_BOOKINGREPORTS_SECRET'}[app]
            with patch.object(settings, secret_field, 'isolated-integration-secret'):
                status, entitlement = await self.request('GET', f'/api/integrations/applications/{app}/subjects/{self.subject}',
                    user=None, headers_extra={'X-DTL-Integration-Secret': 'isolated-integration-secret'})
            self.assertEqual(status, 200, entitlement)
            self.assertEqual(entitlement['role_keys'], ['basic', 'extra'])
            self.assertEqual(entitlement['permission_keys'], ['write'])
            self.assertEqual(entitlement['policy_import_id'], payload['operation_id'])

    async def test_retry_does_not_restore_imported_rights_after_admin_edits(self):
        payload = await self.payload('workflows')
        self.assertEqual((await self.confirm('workflows', payload))[0], 200)
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ('bob', 'workflows'))
            grant.permission_overrides = {'view': True, 'write': False, 'delete': False}
            await db.commit()
        status, result, remote = await self.confirm('workflows', payload)
        self.assertEqual(status, 200, result); remote.assert_not_awaited()
        async with self.sessions() as db:
            self.assertFalse((await db.get(UserApplicationAccess, ('bob', 'workflows'))).permission_overrides['write'])
            self.assertEqual(await db.scalar(select(func.count()).select_from(AccessAuditLog).where(AccessAuditLog.action == 'application_policy_imported')), 1)

    async def test_stale_grant_non_admin_or_changed_remote_account_never_imports(self):
        payload = await self.payload('itam')
        self.assertEqual((await self.confirm('itam', payload, user='bob'))[0], 403)
        status, _, remote = await self.confirm('itam', {**payload, 'expected_grant_updated_at': 'stale'})
        self.assertEqual(status, 409); remote.assert_not_awaited()
        self.assertEqual((await self.confirm('itam', payload, {**self.snapshot(), 'account': {'id': 'other'}}))[0], 502)

    async def test_unknown_catalog_and_invalid_snapshot_cannot_replace_central_grant(self):
        for snapshot, expected in (({**self.snapshot(), 'role_keys': ['missing']}, 409),
                                   ({**self.snapshot(), 'permission_keys': ['unknown']}, 502)):
            payload = await self.payload('bookingreports')
            self.assertEqual((await self.confirm('bookingreports', payload, snapshot))[0], expected)
            async with self.sessions() as db:
                self.assertIsNone(await db.get(ApplicationPolicyOwnership, ('bob', 'bookingreports')))
                self.assertEqual((await db.get(UserApplicationAccess, ('bob', 'bookingreports'))).role_id, 'bookingreports:basic')

    async def test_form_opened_before_handover_cannot_overwrite_imported_rights(self):
        payload = await self.payload('workflows')
        self.assertEqual((await self.confirm('workflows', payload))[0], 200)
        path = '/api/admin/applications/workflows/users/bob'
        changes = {'enabled': True, 'permission_keys': ['delete']}
        self.assertEqual((await self.request('PUT', path, payload={**changes, 'expected_updated_at': payload['expected_grant_updated_at']}))[0], 409)
        async with self.sessions() as db:
            stamp = (await db.get(UserApplicationAccess, ('bob', 'workflows'))).updated_at.isoformat()
        status, value = await self.request('PUT', path, payload={**changes, 'expected_updated_at': stamp})
        self.assertEqual(status, 200, value)
        self.assertEqual(value['permission_keys'], ['delete'])
        self.assertEqual(value['role_keys'], ['basic', 'extra'])
        status, replacement = await self.request('PUT', path, payload={'enabled': True, 'role_key': 'basic',
            'permission_keys': ['view'], 'expected_updated_at': value['access_updated_at']})
        self.assertEqual(status, 200, replacement)
        self.assertEqual(replacement['role_keys'], ['basic'])

    async def test_booking_admin_semantics_cannot_display_ineffective_permission_denials(self):
        async with self.sessions() as db:
            db.add(ApplicationRole(id='bookingreports:admin', application_key='bookingreports', key='admin', display_name='Admin'))
            await db.commit()
        path = '/api/admin/applications/bookingreports/users/bob'
        status, value = await self.request('PUT', path, payload={'enabled': True, 'role_key': 'admin', 'permission_keys': ['view']})
        self.assertEqual(status, 422, value)
        status, value = await self.request('PUT', path, payload={'enabled': True, 'role_key': 'admin'})
        self.assertEqual(status, 200, value)
        self.assertEqual(value['permission_keys'], ['delete', 'view', 'write'])
        # Choosing a non-admin role still supports explicit individual grants.
        status, value = await self.request('PUT', path, payload={'enabled': True, 'role_key': 'basic', 'permission_keys': ['view']})
        self.assertEqual(status, 200, value)
        self.assertEqual(value['permission_keys'], ['view'])

    async def test_importing_account_without_roles_does_not_add_a_default_on_permission_edit(self):
        payload = await self.payload('workflows')
        self.assertEqual((await self.confirm('workflows', payload, {**self.snapshot(), 'role_keys': []}))[0], 200)
        async with self.sessions() as db:
            grant = await db.get(UserApplicationAccess, ('bob', 'workflows'))
            self.assertIsNone(grant.role_id)
            stamp = grant.updated_at.isoformat()
        status, value = await self.request('PUT', '/api/admin/applications/workflows/users/bob', payload={
            'enabled': True, 'permission_keys': ['delete'], 'expected_updated_at': stamp})
        self.assertEqual(status, 200, value)
        self.assertIsNone(value['role_key'])
        self.assertEqual(value['role_keys'], [])

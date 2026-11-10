from tests.support.api_case import ApiTestCase
from unittest.mock import AsyncMock, patch
from app.db.access import AccessPermission, AccessRole, RolePermission, UserRole
from app.db.applications import Application, ApplicationPermission, ApplicationRole, ApplicationRolePermission, UserApplicationAccess
from app.modules.access.service import MANAGE


class ApplicationDefaultRoleTests(ApiTestCase):
    async def seed(self):
        async with self.sessions() as db:
            db.add(AccessRole(id='grant-admin',name='Grant administrator'))
            db.add(AccessPermission(code=MANAGE,name='Manage app access'))
            await db.flush()
            db.add(RolePermission(role_id='grant-admin',permission_code=MANAGE))
            db.add(UserRole(user_id='alice',role_id='grant-admin'))
            for app,key in [('workflows','USER'),('bookingreports','sales'),('itam','Nhan_Vien_HC')]:
                db.add(Application(key=app,display_name=app,launch_url='https://example.test',permission_prefix=app))
                await db.flush()
                # Deliberately keep the privileged role first and use opaque IDs.
                db.add(ApplicationRole(id=app+':legacy-admin',application_key=app,key='ADMIN',display_name='Administrator',sort_order=1))
                db.add(ApplicationRole(id=app+':opaque-default',application_key=app,key=key,display_name='Default user',sort_order=999))
                db.add(ApplicationPermission(id=app+':read',application_key=app,code='read',display_name='Read'))
                db.add(ApplicationPermission(id=app+':manage',application_key=app,code='manage',display_name='Manage'))
                await db.flush()
                db.add(ApplicationRolePermission(role_id=app+':legacy-admin',permission_id=app+':manage'))
                db.add(ApplicationRolePermission(role_id=app+':opaque-default',permission_id=app+':read'))
            await db.commit()

    async def test_first_grant_uses_business_default_not_first_role_or_generated_id(self):
        await self.seed()
        for app,key in [('workflows','USER'),('bookingreports','sales'),('itam','Nhan_Vien_HC')]:
            status,value=await self.request('PUT',f'/api/admin/applications/{app}/users/bob',payload={'enabled':True})
            self.assertEqual(status,200,value);self.assertEqual(value['role_key'],key)
            self.assertEqual(value['permission_keys'],['read'])

    async def test_reenable_keeps_existing_role_overrides_and_project_scope(self):
        await self.seed()
        async with self.sessions() as db:
            db.add(UserApplicationAccess(user_id='bob',application_key='workflows',enabled=False,role_id='workflows:legacy-admin',permission_overrides={'manage':False,'read':True},project_names=['Project A'],granted_by_id='alice'))
            await db.commit()
        status,value=await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True})
        self.assertEqual(status,200,value);self.assertEqual(value['role_key'],'ADMIN')
        self.assertEqual(value['permission_keys'],['read']);self.assertEqual(value['project_names'],['Project A'])

    async def test_missing_named_default_never_falls_back_to_administrator(self):
        await self.seed()
        async with self.sessions() as db:
            role=await db.get(ApplicationRole,'itam:opaque-default');role.key='AnotherRole';await db.commit()
        status,_=await self.request('PUT','/api/admin/applications/itam/users/bob',payload={'enabled':True})
        self.assertEqual(status,409)
        async with self.sessions() as db:self.assertIsNone(await db.get(UserApplicationAccess,('bob','itam')))

    async def test_explicit_administrator_choice_still_applies(self):
        await self.seed()
        status,value=await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True,'role_key':'ADMIN'})
        self.assertEqual(status,200,value);self.assertEqual(value['role_key'],'ADMIN')
        self.assertEqual(value['permission_keys'],['manage'])

    async def test_revoke_without_role_does_not_assign_a_business_default(self):
        await self.seed()
        status,value=await self.request('PUT','/api/admin/applications/itam/users/bob',payload={'enabled':False})
        self.assertEqual(status,200,value);self.assertFalse(value['enabled']);self.assertIsNone(value['role_key'])

    async def test_workflow_hint_runs_after_commit_and_only_for_real_policy_changes(self):
        await self.seed()
        observed=[]
        async def committed(target_id,subject):
            async with self.sessions() as db:
                grant=await db.get(UserApplicationAccess,(target_id,'workflows'))
                observed.append((grant.enabled,grant.role_id))
        callback=AsyncMock(side_effect=committed)
        with patch('app.modules.applications.policy_notifications.notify_workflow_policy_changed',callback):
            status,_=await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True})
            self.assertEqual(status,200);self.assertEqual(observed,[(True,'workflows:opaque-default')])
            await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True})
            self.assertEqual(callback.await_count,1)
            await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':False})
            self.assertEqual(observed[-1],(False,'workflows:opaque-default'));self.assertEqual(callback.await_count,2)
            await self.request('PUT','/api/admin/applications/itam/users/bob',payload={'enabled':True})
            self.assertEqual(callback.await_count,2)

    async def test_invalid_grant_does_not_send_hint(self):
        await self.seed()
        callback=AsyncMock()
        with patch('app.modules.applications.policy_notifications.notify_workflow_policy_changed',callback):
            status,_=await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True,'role_key':'UNKNOWN'})
            self.assertEqual(status,422)
        callback.assert_not_awaited()

    async def test_unavailable_workflow_hint_does_not_undo_saved_grant(self):
        from fastapi import HTTPException
        await self.seed()
        with patch('app.modules.applications.account_linking.configuration',return_value='http://workflow.test'), patch('app.modules.applications.account_linking.workflow_request',AsyncMock(side_effect=HTTPException(503,'Unavailable'))):
            status,value=await self.request('PUT','/api/admin/applications/workflows/users/bob',payload={'enabled':True})
        self.assertEqual(status,200,value);self.assertTrue(value['enabled'])
        async with self.sessions() as db:
            self.assertTrue((await db.get(UserApplicationAccess,('bob','workflows'))).enabled)

    async def test_assets_and_booking_hints_run_after_commit_only_when_changed(self):
        await self.seed()
        observed = []
        async def committed(application, target_id, subject):
            async with self.sessions() as db:
                grant = await db.get(UserApplicationAccess, (target_id, application))
                observed.append((application, grant.enabled))
        with patch('app.modules.applications.policy_notifications.notify_application_policy_changed',
                   AsyncMock(side_effect=committed)) as callback:
            for application in ('itam', 'bookingreports'):
                path = f'/api/admin/applications/{application}/users/bob'
                self.assertEqual((await self.request('PUT', path, payload={'enabled': True}))[0], 200)
                self.assertEqual((await self.request('PUT', path, payload={'enabled': True}))[0], 200)
                self.assertEqual((await self.request('PUT', path, payload={'enabled': False}))[0], 200)
            self.assertEqual(callback.await_count, 4)
        self.assertEqual(observed, [('itam', True), ('itam', False), ('bookingreports', True), ('bookingreports', False)])

    async def test_destination_hint_failure_does_not_undo_grant(self):
        from fastapi import HTTPException
        await self.seed()
        with patch('app.modules.applications.policy_linking.integration', return_value=('http://private.test', 'private-secret')), \
             patch('app.modules.applications.policy_linking.remote', AsyncMock(side_effect=HTTPException(503, 'Unavailable'))):
            for application in ('itam', 'bookingreports'):
                status, value = await self.request('PUT', f'/api/admin/applications/{application}/users/bob', payload={'enabled': True})
                self.assertEqual(status, 200, value)
                self.assertTrue(value['enabled'])

    async def test_destination_hint_contains_identity_only(self):
        from app.modules.applications.policy_notifications import notify_application_policy_changed
        with patch('app.modules.applications.policy_linking.integration', return_value=('http://private.test', 'private-secret')), \
             patch('app.modules.applications.policy_linking.remote', AsyncMock(return_value={'notified': 1})) as remote:
            await notify_application_policy_changed('itam', 'bob', 'subject-bob')
        remote.assert_awaited_once_with('itam', 'POST', '/policy-changed', body={'platform_user_id': 'bob', 'identity_subject': 'subject-bob'})

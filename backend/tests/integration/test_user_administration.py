from unittest.mock import AsyncMock, patch

from app.db.access import AccessPermission, AccessRole, RolePermission, UserRole
from app.modules.access.service import MANAGE
from app.db.models import User
from tests.support.api_case import ApiTestCase


class UserAdministrationTests(ApiTestCase):
    async def seed_admin(self):
        async with self.sessions() as db:
            db.add_all([
                AccessRole(id='test-admin', name='Test administrator'),
                AccessPermission(code=MANAGE, name='Manage access'),
            ])
            await db.flush()
            db.add_all([
                RolePermission(role_id='test-admin', permission_code=MANAGE),
                UserRole(user_id='alice', role_id='test-admin'),
            ])
            await db.commit()

    async def test_create_update_lock_and_reset_password(self):
        await self.seed_admin()
        create_payload = {
            'username': 'new.user', 'email': 'new.user@example.com',
            'full_name': 'New User', 'password': 'safe-password-123',
            'department': 'Kinh doanh', 'job_title': 'Chuyên viên',
            'employee_code': 'DTL-100', 'phone': '0900000000',
            'office_location': 'TP. Hồ Chí Minh', 'platform_admin': False,
        }
        with patch('app.modules.users.router.keycloak_user_admin.create_user', new=AsyncMock(return_value='kc-new-user')):
            status, created = await self.request('POST', '/api/admin/users', payload=create_payload)
        self.assertEqual(status, 201)
        self.assertEqual(created['identity_subject'], 'kc-new-user')
        self.assertFalse(created['platform_admin'])

        update_payload = {
            'email': 'new.user@dongtayland.vn', 'full_name': 'Người Dùng Mới',
            'department': 'Kinh doanh', 'job_title': 'Chuyên viên',
            'employee_code': 'DTL-100', 'phone': '0911111111',
            'office_location': 'TP. Hồ Chí Minh', 'is_active': False,
            'platform_admin': False,
        }
        update = AsyncMock()
        logout = AsyncMock()
        with patch('app.modules.users.router.keycloak_user_admin.update_user', new=update), patch(
            'app.modules.users.router.keycloak_user_admin.logout_user', new=logout
        ):
            status, changed = await self.request('PUT', f"/api/admin/users/{created['id']}", payload=update_payload)
        self.assertEqual(status, 200)
        self.assertFalse(changed['is_active'])
        update.assert_awaited_once()
        logout.assert_awaited_once_with('kc-new-user')

        reset = AsyncMock()
        repair_profile = AsyncMock()
        with patch('app.modules.users.router.keycloak_user_admin.reset_password', new=reset), patch(
            'app.modules.users.router.keycloak_user_admin.update_user', new=repair_profile
        ):
            status, body = await self.request(
                'PUT', f"/api/admin/users/{created['id']}/password",
                payload={'password': 'another-safe-password'},
            )
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        reset.assert_awaited_once_with('kc-new-user', 'another-safe-password')
        repair_profile.assert_awaited_once()

    async def test_cannot_disable_own_admin_account(self):
        await self.seed_admin()
        payload = {
            'email': 'alice@example.com', 'full_name': 'Alice', 'department': '',
            'job_title': '', 'employee_code': '', 'phone': '', 'office_location': '',
            'is_active': False, 'platform_admin': False,
        }
        status, result = await self.request('PUT', '/api/admin/users/alice', payload=payload)
        self.assertEqual(status, 422)
        self.assertIn('chính mình', result['detail'])

    async def test_organization_hierarchy_locations_and_manager_candidates(self):
        await self.seed_admin()
        _, department = await self.request('POST', '/api/admin/organization/departments', payload={'code':'TECH','name':'Công nghệ'})
        _, director = await self.request('POST', '/api/admin/organization/job-levels', payload={'code':'DIRECTOR','name':'Giám đốc','rank':1,'is_management':True})
        _, lead = await self.request('POST', '/api/admin/organization/job-levels', payload={'code':'LEAD','name':'Trưởng nhóm','rank':5,'is_management':True,'report_to_level_ids':[director['id']]})
        _, staff = await self.request('POST', '/api/admin/organization/job-levels', payload={'code':'STAFF2','name':'Nhân viên','rank':10,'is_management':False,'report_to_level_ids':[lead['id'],director['id']]})
        _, manager_position = await self.request('POST', '/api/admin/organization/positions', payload={'code':'TECH-DIR','name':'Giám đốc công nghệ','department_id':department['id'],'job_level_id':director['id']})
        _, staff_position = await self.request('POST', '/api/admin/organization/positions', payload={'code':'TECH-STAFF','name':'Chuyên viên công nghệ','department_id':department['id'],'job_level_id':staff['id']})
        _, location = await self.request('POST', '/api/admin/organization/work-locations', payload={'code':'HCM','name':'Trụ sở TP. Hồ Chí Minh'})
        async with self.sessions() as db:
            alice = await db.get(User, 'alice'); alice.position_id = manager_position['id']; await db.commit()
        status, managers = await self.request('GET', '/api/admin/users/manager-candidates', query={'position_id':staff_position['id']})
        self.assertEqual(status, 200); self.assertEqual([item['id'] for item in managers], ['alice'])
        _, catalog = await self.request('GET', '/api/admin/organization')
        self.assertEqual(catalog['work_locations'][0]['id'], location['id'])
        self.assertTrue(next(item for item in catalog['job_levels'] if item['id']==director['id'])['is_management'])
        self.assertEqual(set(next(item for item in catalog['job_levels'] if item['id']==staff['id'])['report_to_level_ids']), {lead['id'],director['id']})

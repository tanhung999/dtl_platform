from unittest.mock import AsyncMock, patch

from app.db.access import AccessPermission, AccessRole, RolePermission, UserRole
from app.modules.access.service import MANAGE
from app.db.migrations.organization_catalog import unique_code
from tests.support.api_case import ApiTestCase


class UserAdministrationTests(ApiTestCase):
    def test_generated_organization_code_fits_database_column(self):
        generated = unique_code('Trưởng Nhóm Phát Triển Phần Mềm', 'a613bb19-9303-43ef-baed-b2303851755e')
        self.assertLessEqual(len(generated), 30)
        self.assertTrue(generated.endswith('_a613'))

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
            'full_name': 'New User', 'password': 'Pass@123',
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
                payload={'password': 'Next@123'},
            )
        self.assertEqual(status, 204)
        self.assertIsNone(body)
        reset.assert_awaited_once_with('kc-new-user', 'Next@123')
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

    async def test_organization_has_positions_departments_locations_without_hierarchy(self):
        await self.seed_admin()
        _, department = await self.request('POST', '/api/admin/organization/departments', payload={'code':'TECH','name':'Technology'})
        status, position = await self.request('POST', '/api/admin/organization/positions', payload={'code':'TECH-POS','name':'Staff','department_id':department['id']})
        self.assertEqual(status, 201)
        _, location = await self.request('POST', '/api/admin/organization/work-locations', payload={'code':'HCM','name':'Head office'})
        _, catalog = await self.request('GET', '/api/admin/organization')
        self.assertEqual(catalog['work_locations'][0]['id'], location['id'])
        self.assertEqual(catalog['positions'][0]['id'], position['id'])
        self.assertNotIn('job_levels', catalog)
        self.assertEqual((await self.request('POST', '/api/admin/organization/job-levels', payload={'code':'OLD','name':'Removed'}))[0], 422)

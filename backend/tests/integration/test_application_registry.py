from tests.support.api_case import ApiTestCase
from app.db.applications import (
    Application, ApplicationPermission, ApplicationRole, ApplicationRolePermission,
    UserApplicationAccess,
)
from app.db.access import AccessPermission, AccessRole, RolePermission, UserRole
from app.modules.access.service import APPLICATIONS_MANAGE
from app.core.config import settings
from app.db.models import User
from app.db.migrations.development_applications import migrate_development_applications
from urllib.parse import parse_qs, urlsplit


class ApplicationRegistryTests(ApiTestCase):
    async def test_development_apps_are_seeded_idempotently_and_visible(self):
        async with self.engine.begin() as conn:
            await migrate_development_applications(conn)
            await migrate_development_applications(conn)

        status, apps = await self.request('GET', '/api/applications/me')
        self.assertEqual(status, 200)
        self.assertEqual(
            [(app['key'], app['display_name'], app['icon_key'], app['is_active']) for app in apps],
            [
                ('hrm', 'DT HRM', 'hrm', False),
                ('income-statement', 'DT Income Statement', 'income', False),
                ('sales-commission', 'DT Sales Commission', 'salesCommission', False),
            ],
        )
        status, result = await self.request('POST', '/api/sso/launch', payload={'target_app': 'hrm'})
        self.assertEqual(status, 503)
        self.assertIn('giai đoạn phát triển', result['detail'])

    async def seed(self):
        async with self.sessions() as db:
            db.add_all([
                AccessRole(id='application-admin', name='Application administrator'),
                AccessPermission(code=APPLICATIONS_MANAGE, name='Manage applications'),
                Application(key='allowed', display_name='Allowed app', description='Visible',
                    icon_key='platform', launch_url='https://allowed.test', permission_prefix='allowed'),
                Application(key='denied', display_name='Denied app', description='Hidden',
                    icon_key='platform', launch_url='https://denied.test', permission_prefix='denied'),
                Application(key='development', display_name='Development app', description='Coming soon',
                    icon_key='platform', launch_url='https://development.test', permission_prefix='development',
                    is_active=False),
                Application(key='coming-soon', display_name='Coming soon', description='Visible placeholder',
                    icon_key='hrm', launch_url='', callback_path='', permission_prefix='coming-soon',
                    is_active=False, sort_order=190),
                UserApplicationAccess(user_id='alice', application_key='allowed'),
                UserApplicationAccess(user_id='alice', application_key='development'),
            ])
            await db.flush()
            db.add_all([
                RolePermission(role_id='application-admin', permission_code=APPLICATIONS_MANAGE),
                UserRole(user_id='alice', role_id='application-admin'),
            ])
            await db.commit()

    async def test_registry_returns_discoverable_apps_and_launch_is_enforced(self):
        await self.seed()
        status, apps = await self.request('GET', '/api/applications/me')
        self.assertEqual(status, 200)
        self.assertEqual([app['key'] for app in apps], ['allowed', 'denied', 'development', 'coming-soon'])

        status, result = await self.request('POST', '/api/sso/launch', payload={'target_app': 'allowed'})
        self.assertEqual(status, 200)
        self.assertTrue(result['launch_url'].startswith('https://allowed.test/sso-callback?ticket='))
        status, verified = await self.request('POST', '/api/sso/verify', user=None, payload={'ticket': result['ticket'], 'expected_app': 'allowed'})
        self.assertEqual(status, 200)
        self.assertTrue(verified['valid'])
        self.assertEqual(verified['claims']['identity_subject'], 'platform:alice')
        status, _ = await self.request('POST', '/api/sso/verify', user=None, payload={'ticket': result['ticket'], 'expected_app': 'allowed'})
        self.assertEqual(status, 409)

        async with self.sessions() as db:
            db.add(Application(
                key='oidc-app', display_name='OIDC app', description='Central login',
                icon_key='platform', launch_url='https://oidc.test',
                callback_path='/api/auth/platform/callback', oidc_client_id='oidc-app',
                permission_prefix='oidc-app',
            ))
            db.add(UserApplicationAccess(user_id='alice', application_key='oidc-app'))
            await db.commit()
        status, oidc_launch = await self.request('POST', '/api/sso/launch', payload={'target_app': 'oidc-app'})
        self.assertEqual(status, 200)
        self.assertTrue(oidc_launch['ticket'])
        parsed_launch = urlsplit(oidc_launch['launch_url'])
        self.assertEqual(parsed_launch.path, '/api/auth/platform/callback')
        self.assertEqual(parse_qs(parsed_launch.query)['return_to'], ['/'])
        self.assertEqual(parse_qs(parsed_launch.query)['ticket'], [oidc_launch['ticket']])

        status, deep_link = await self.request(
            'POST', '/api/sso/launch',
            payload={'target_app': 'oidc-app', 'return_to': '/documents/42?tab=history'},
        )
        self.assertEqual(status, 200)
        parsed_deep_link = urlsplit(deep_link['launch_url'])
        self.assertEqual(parse_qs(parsed_deep_link.query)['return_to'], ['/documents/42?tab=history'])
        self.assertEqual(parse_qs(parsed_deep_link.query)['ticket'], [deep_link['ticket']])
        status, invalid_return = await self.request(
            'POST', '/api/sso/launch',
            payload={'target_app': 'oidc-app', 'return_to': 'https://evil.example/'},
        )
        self.assertEqual(status, 422)

        status, result = await self.request('POST', '/api/sso/launch', payload={'target_app': 'denied'})
        self.assertEqual(status, 403)
        self.assertIn('chưa được cấp quyền', result['detail'])

        status, _ = await self.request('POST', '/api/sso/launch', payload={'target_app': 'missing'})
        self.assertEqual(status, 404)

        status, development = await self.request('POST', '/api/sso/launch', payload={'target_app': 'development'})
        self.assertEqual(status, 503)
        self.assertIn('giai đoạn phát triển', development['detail'])

        status, coming_soon = await self.request('POST', '/api/sso/launch', payload={'target_app': 'coming-soon'})
        self.assertEqual(status, 503)
        self.assertIn('giai đoạn phát triển', coming_soon['detail'])

        status, access = await self.request('GET', '/api/admin/applications/users/bob/access')
        self.assertEqual(status, 200)
        self.assertFalse(any(item['enabled'] for item in access))
        status, changed = await self.request('PUT', '/api/admin/applications/allowed/users/bob', payload={'enabled': True})
        self.assertEqual(status, 200)
        self.assertTrue(changed['enabled'])
        status, bob_apps = await self.request('GET', '/api/applications/me', user='bob')
        self.assertEqual(status, 200)
        self.assertEqual([app['key'] for app in bob_apps], ['allowed', 'denied', 'development', 'oidc-app', 'coming-soon'])

    async def test_private_entitlement_contract_fails_closed(self):
        await self.seed()
        previous_secret = settings.INTEGRATION_SHARED_SECRET
        settings.INTEGRATION_SHARED_SECRET = 'integration-test-secret'
        try:
            async with self.sessions() as db:
                alice = await db.get(User, 'alice')
                alice.identity_subject = 'keycloak-alice'
                role = ApplicationRole(id='allowed:viewer', application_key='allowed', key='viewer', display_name='Viewer')
                permission = ApplicationPermission(id='allowed:read', application_key='allowed', code='read', display_name='Read')
                db.add_all([role, permission])
                await db.flush()
                db.add(ApplicationRolePermission(role_id=role.id, permission_id=permission.id))
                grant = await db.get(UserApplicationAccess, ('alice', 'allowed'))
                grant.role_id = role.id
                grant.project_names = ['Project A']
                await db.commit()

            status, _ = await self.request(
                'GET',
                '/api/integrations/applications/allowed/subjects/keycloak-alice',
                user=None,
            )
            self.assertEqual(status, 401)

            status, result = await self.request(
                'GET',
                '/api/integrations/applications/allowed/subjects/keycloak-alice',
                user=None,
                headers_extra={'X-DTL-Integration-Secret': 'integration-test-secret'},
            )
            self.assertEqual(status, 200)
            self.assertTrue(result['allowed'])
            self.assertEqual(result['username'], 'alice')
            self.assertEqual(result['role_key'], 'viewer')
            self.assertEqual(result['permission_keys'], ['read'])
            self.assertEqual(result['project_names'], ['Project A'])

            status, local_identity = await self.request(
                'GET',
                '/api/integrations/applications/allowed/subjects/platform:alice',
                user=None,
                headers_extra={'X-DTL-Integration-Secret': 'integration-test-secret'},
            )
            self.assertEqual(status, 200)
            self.assertTrue(local_identity['allowed'])
            self.assertEqual(local_identity['username'], 'alice')

            status, denied = await self.request(
                'GET',
                '/api/integrations/applications/denied/subjects/keycloak-alice',
                user=None,
                headers_extra={'X-DTL-Integration-Secret': 'integration-test-secret'},
            )
            self.assertEqual(status, 200)
            self.assertFalse(denied['allowed'])
        finally:
            settings.INTEGRATION_SHARED_SECRET = previous_secret

    async def test_manifest_registers_future_app_authorization_catalog(self):
        await self.seed()
        manifest = {
            'application': {
                'key': 'future-app',
                'display_name': 'Future App',
                'description': 'Registered without a Platform code migration',
                'category': 'Ứng dụng doanh nghiệp',
                'icon_key': 'platform',
                'launch_url': 'https://future.test',
                'callback_path': '/api/auth/oidc/login',
                'oidc_client_id': 'future-app',
                'oidc_audience': 'future-app',
                'permission_prefix': 'future',
                'is_active': True,
                'sort_order': 90,
            },
            'permissions': [
                {'code': 'future.read', 'display_name': 'Xem dữ liệu'},
                {'code': 'future.manage', 'display_name': 'Quản trị dữ liệu'},
            ],
            'roles': [
                {
                    'key': 'viewer',
                    'display_name': 'Người xem',
                    'permission_keys': ['future.read'],
                },
            ],
        }
        status, result = await self.request(
            'PUT', '/api/admin/applications/future-app/manifest', payload=manifest
        )
        self.assertEqual(status, 200)
        self.assertEqual(result['key'], 'future-app')

        status, access = await self.request(
            'GET', '/api/admin/applications/users/bob/access'
        )
        self.assertEqual(status, 200)
        future = next(item for item in access if item['key'] == 'future-app')
        self.assertEqual(future['roles'][0]['key'], 'viewer')
        self.assertEqual(future['roles'][0]['permission_keys'], ['future.read'])

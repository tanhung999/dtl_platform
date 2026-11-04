from unittest.mock import AsyncMock, patch

from sqlalchemy import func, select

from tests.support.api_case import ApiTestCase
from app.db.access import AccessAuditLog, AccessPermission, AccessRole, CalendarShare, RolePermission, UserRole
from app.db.models import User
from app.db.organization import Department, Position
from app.modules.access.service import (
    CAPABILITY_ROLES, MANAGE, SHARE, TASKS_ASSIGN, has_permission, seed_catalog,
)


class PlatformPermissionsTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            await seed_catalog(db)
            department = Department(id='dept', code='TEST', name='Test department')
            db.add(department); await db.flush()
            db.add(Position(id='pos', code='TEST', name='Staff', department_id=department.id)); await db.flush()
            bob = await db.get(User, 'bob'); bob.position_id = 'pos'
            db.add(UserRole(user_id='alice', role_id='access_admin'))
            await db.commit()

    async def policy(self, user_id='bob'):
        status, body = await self.request('GET', f'/api/access/users/{user_id}/platform-permissions')
        self.assertEqual(status, 200, body)
        return body

    async def save(self, permissions, *, original=None, user_id='bob', actor='alice'):
        original = original if original is not None else await self.policy(user_id)
        return await self.request('PUT', f'/api/access/users/{user_id}/platform-permissions', user=actor,
            payload={'permissions': permissions, 'expected_permissions': original['permissions'],
                     'expected_version': original['access_version']})

    async def test_migration_preserves_legacy_admin_and_is_repeatable(self):
        from app.db.migrations.platform_permissions import migrate_platform_permissions
        async with self.engine.begin() as conn:
            await migrate_platform_permissions(conn)
            await migrate_platform_permissions(conn)
        _, caps = await self.request('GET', '/api/access/me')
        for key in ('can_manage', 'can_access_admin'):
            self.assertTrue(caps[key])
        self.assertFalse(caps['can_share'])
        # The new single-capability role must remain granular after migration.
        async with self.sessions() as db:
            links = set((await db.scalars(select(RolePermission.permission_code).where(
                RolePermission.role_id == CAPABILITY_ROLES[MANAGE]))).all())
            self.assertEqual(links, {MANAGE})

    async def test_platform_administrator_also_manages_accounts(self):
        await self.save([MANAGE])
        self.assertEqual((await self.request('GET', '/api/admin/users', user='bob'))[0], 200)
        self.assertEqual((await self.request('GET', '/api/admin/organization', user='bob'))[0], 200)
        self.assertEqual((await self.request('GET', '/api/access/users/alice/platform-permissions', user='bob'))[0], 200)
        self.assertEqual((await self.request('POST', '/api/admin/organization/departments', user='bob',
            payload={'code': 'X', 'name': 'Example'}))[0], 201)
        self.assertEqual((await self.request('GET', '/api/admin/applications', user='bob'))[0], 200)

    async def test_non_admin_cannot_access_any_administration_section(self):
        await self.save([SHARE])
        self.assertEqual((await self.request('GET', '/api/admin/users', user='bob'))[0], 403)
        self.assertEqual((await self.request('GET', '/api/admin/organization', user='bob'))[0], 403)
        self.assertEqual((await self.request('POST', '/api/admin/organization/departments', user='bob',
            payload={'code': 'X', 'name': 'Example'}))[0], 403)
        self.assertEqual((await self.request('GET', '/api/access/users/alice/platform-permissions', user='bob'))[0], 403)
        self.assertEqual((await self.request('GET', '/api/admin/applications', user='bob'))[0], 403)
        _, caps = await self.request('GET', '/api/access/me', user='bob')
        self.assertFalse(caps['can_access_admin'])
        self.assertFalse(caps['can_manage'])

    async def test_retired_permissions_cannot_be_granted(self):
        for code in ('users.manage', 'organization.manage', 'applications.manage'):
            self.assertEqual((await self.save([code]))[0], 422)
        self.assertEqual((await self.policy())['permissions'], [])

    async def test_migration_retires_partial_roles_without_promoting_users(self):
        from app.db.migrations.platform_permissions import RETIRED_PERMISSIONS, migrate_platform_permissions
        await self.save([SHARE])
        async with self.sessions() as db:
            for code in RETIRED_PERMISSIONS:
                role_id = 'platform_' + code.replace('.', '_')
                db.add_all([AccessPermission(code=code, name=code), AccessRole(id=role_id, name=code)])
                await db.flush()
                db.add_all([RolePermission(role_id=role_id, permission_code=code), UserRole(user_id='bob', role_id=role_id)])
            db.add(CalendarShare(owner_id='bob', viewer_id='alice'))
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_platform_permissions(conn)
            await migrate_platform_permissions(conn)
        latest = await self.policy()
        self.assertEqual(latest['permissions'], [SHARE])
        self.assertEqual(latest['access_version'], 2)
        async with self.sessions() as db:
            self.assertTrue(await has_permission(db, 'alice', MANAGE))
            self.assertFalse(await has_permission(db, 'bob', MANAGE))
            grant = await db.scalar(select(CalendarShare).where(CalendarShare.owner_id == 'bob'))
            self.assertIsNone(grant.revoked_at)
            self.assertEqual(await db.scalar(select(func.count()).select_from(User)), 2)
            for code in RETIRED_PERMISSIONS:
                self.assertIsNone(await db.get(AccessPermission, code))

    async def test_share_revoke_revokes_viewers_but_other_rights_remain(self):
        await self.save([SHARE, TASKS_ASSIGN])
        async with self.sessions() as db:
            db.add(CalendarShare(owner_id='bob', viewer_id='alice'))
            await db.commit()
        status, policy = await self.save([TASKS_ASSIGN])
        self.assertEqual(status, 200, policy)
        async with self.sessions() as db:
            grant = await db.scalar(select(CalendarShare).where(CalendarShare.owner_id == 'bob'))
            self.assertIsNotNone(grant.revoked_at)
            self.assertTrue(await has_permission(db, 'bob', TASKS_ASSIGN))
            self.assertFalse(await has_permission(db, 'bob', SHARE))

    async def test_unchanged_and_retry_do_not_duplicate_audit_or_version(self):
        initial = await self.policy()
        status, same = await self.save([], original=initial)
        self.assertEqual(status, 200)
        self.assertEqual(same, initial)
        status, changed = await self.save([SHARE], original=initial)
        self.assertEqual(status, 200)
        status, replay = await self.save([SHARE], original=initial)
        self.assertEqual(status, 200)
        self.assertEqual(changed, replay)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(AccessAuditLog)), 1)

    async def test_stale_update_and_invalid_permission_are_rejected(self):
        original = await self.policy()
        await self.save([SHARE], original=original)
        self.assertEqual((await self.save([TASKS_ASSIGN], original=original))[0], 409)
        self.assertEqual((await self.save(['unknown.permission']))[0], 422)
        self.assertEqual((await self.policy())['permissions'], [SHARE])

    async def test_self_permission_admin_cannot_be_revoked(self):
        current = await self.policy('alice')
        self.assertEqual((await self.save([SHARE], original=current, user_id='alice'))[0], 422)
        self.assertEqual(await self.policy('alice'), current)

    async def test_custom_role_permissions_cannot_be_silently_removed(self):
        async with self.sessions() as db:
            db.add(AccessRole(id='custom', name='Custom'))
            await db.flush()
            db.add_all([RolePermission(role_id='custom', permission_code=SHARE), UserRole(user_id='bob', role_id='custom')])
            await db.commit()
        self.assertEqual((await self.save([]))[0], 409)
        self.assertEqual((await self.policy())['permissions'], [SHARE])

    async def test_inactive_account_cannot_receive_new_rights(self):
        original = await self.policy()
        async with self.sessions() as db:
            target = await db.get(User, 'bob')
            target.is_active = False
            await db.commit()
        self.assertEqual((await self.save([MANAGE], original=original))[0], 404)

    async def test_extended_legacy_role_does_not_lose_unknown_permissions(self):
        async with self.sessions() as db:
            db.add(AccessPermission(code='custom.extension', name='Existing extension'))
            db.add(UserRole(user_id='bob', role_id='access_admin'))
            await db.flush()
            db.add(RolePermission(role_id='access_admin', permission_code='custom.extension'))
            await db.commit()
        initial = await self.policy()
        self.assertEqual((await self.save([SHARE], original=initial))[0], 409)
        self.assertEqual(await self.policy(), initial)
        async with self.sessions() as db:
            self.assertTrue(await has_permission(db, 'bob', 'custom.extension'))

    async def test_profile_save_without_admin_flag_preserves_permissions(self):
        await self.save([SHARE])
        async with self.sessions() as db:
            user = await db.get(User, 'bob')
            user.identity_subject = 'kc-bob'
            await db.commit()
        payload = {'email': 'bob@example.com', 'full_name': 'Bob Updated', 'is_active': True}
        with patch('app.modules.users.router.keycloak_user_admin.update_user', new=AsyncMock()):
            self.assertEqual((await self.request('PUT', '/api/admin/users/bob', payload=payload))[0], 200)
        self.assertEqual(set((await self.policy())['permissions']), {SHARE})
        # A regular user cannot elevate an account using the former profile checkbox.
        self.assertEqual((await self.request('PUT', '/api/admin/users/bob', user='bob',
            payload={**payload, 'platform_admin': True}))[0], 403)

    async def test_non_administrator_cannot_reset_or_edit_accounts(self):
        await self.save([SHARE])
        with patch('app.modules.users.router.keycloak_user_admin.reset_password', new=AsyncMock()) as reset:
            status, _ = await self.request('PUT', '/api/admin/users/alice/password', user='bob',
                payload={'password': 'Test-only@123'})
            self.assertEqual(status, 403)
            reset.assert_not_awaited()
        with patch('app.modules.users.router.keycloak_user_admin.update_user', new=AsyncMock()) as update_user:
            status, _ = await self.request('PUT', '/api/admin/users/alice', user='bob',
                payload={'email': 'changed@example.com', 'full_name': 'Changed', 'is_active': True})
            self.assertEqual(status, 403)
            update_user.assert_not_awaited()

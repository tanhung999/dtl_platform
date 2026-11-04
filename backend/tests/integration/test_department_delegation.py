from unittest.mock import AsyncMock, patch
from sqlalchemy import select

from tests.support.api_case import ApiTestCase
from app.db.access import UserRole
from app.db.models import User
from app.db.organization import Department, Position, TaskAssignmentDepartment, TaskAssignmentPolicy
from app.modules.access.service import MANAGE, TASKS_ASSIGN, seed_catalog


class DepartmentDelegationTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add_all([Department(id='hr', code='HR', name='Human resources'), Department(id='finance', code='FIN', name='Finance')])
            await db.flush()
            db.add_all([Position(id='hr-staff', code='HR-STAFF', name='Staff', department_id='hr'),
                Position(id='hr-lead', code='HR-LEAD', name='Department head', department_id='hr'),
                Position(id='fin-staff', code='FIN-STAFF', name='Staff', department_id='finance')])
            await db.flush()
            for identifier in ('alice', 'bob'):
                user = await db.get(User, identifier)
                user.position_id = 'hr-staff'; user.identity_subject = 'kc-' + identifier
            db.add(UserRole(user_id='alice', role_id='access_admin'))
            db.add(User(id='charlie', username='charlie', email='charlie@example.com', full_name='Charlie', position_id='fin-staff', password_hash='unused'))
            await db.commit()

    async def grant(self, ids=None, permissions=None, initial=None):
        if initial is None:
            _, initial = await self.request('GET', '/api/access/users/bob/platform-permissions')
        scope = {'mode': 'current_department', 'department_ids': []} if ids is None else {'mode': 'selected_departments', 'department_ids': ids}
        return await self.request('PUT', '/api/access/users/bob/platform-permissions', payload={
            'permissions': permissions if permissions is not None else [TASKS_ASSIGN],
            'expected_permissions': initial['permissions'], 'expected_version': initial['access_version'], 'assignment_scope': scope})

    async def assign(self, target):
        return await self.request('POST', '/api/tasks', user='bob', payload={'title': 'Department work', 'assignee_id': target})

    async def move_user(self, position):
        with patch('app.modules.users.router.keycloak_user_admin.update_user', new=AsyncMock()):
            return await self.request('PUT', '/api/admin/users/bob', payload={
                'email': 'bob@example.com', 'full_name': 'Bob', 'is_active': True, 'position_id': position})

    async def test_title_never_grants_delegation_and_admin_is_unrestricted(self):
        await self.move_user('hr-lead')
        self.assertEqual((await self.assign('alice'))[0], 403)
        _, capabilities = await self.request('GET', '/api/access/me', user='bob')
        self.assertFalse(capabilities['can_assign_tasks'])
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Admin', 'assignee_id': 'charlie'}))[0], 201)

    async def test_current_department_and_multiple_department_scopes(self):
        self.assertEqual((await self.grant())[0], 200)
        self.assertEqual((await self.assign('alice'))[0], 201)
        self.assertEqual((await self.assign('charlie'))[0], 403)
        self.assertEqual((await self.grant(['hr', 'finance']))[0], 200)
        self.assertEqual((await self.assign('charlie'))[0], 201)
        self.assertEqual((await self.grant(['finance']))[0], 200)
        self.assertEqual((await self.assign('alice'))[0], 403)

    async def test_validation_empty_unknown_inactive_and_missing_home_department(self):
        for ids in ([], ['unknown']):
            self.assertEqual((await self.grant(ids))[0], 422)
        self.assertEqual((await self.grant(['unknown'], permissions=[MANAGE, TASKS_ASSIGN]))[0], 422)
        async with self.sessions() as db:
            dept = await db.get(Department, 'finance'); dept.is_active = False
            await db.commit()
        self.assertEqual((await self.grant(['finance']))[0], 422)
        await self.move_user(None)
        self.assertEqual((await self.grant())[0], 422)

    async def test_switching_departments_revokes_and_clears_scope_but_preserves_task(self):
        await self.grant(['hr', 'finance'])
        _, task = await self.assign('alice')
        status, _ = await self.move_user('fin-staff')
        self.assertEqual(status, 200)
        _, policy = await self.request('GET', '/api/access/users/bob/platform-permissions')
        self.assertNotIn(TASKS_ASSIGN, policy['permissions'])
        self.assertEqual(policy['assignment_scope'], {'mode': 'current_department', 'department_ids': []})
        self.assertEqual((await self.assign('charlie'))[0], 403)
        status, detail = await self.request('GET', '/api/tasks/' + task['id'], user='bob')
        self.assertEqual(status, 200); self.assertTrue(detail['can_edit'])
        self.assertEqual(detail['assignee_id'], 'alice')
        self.assertEqual((await self.grant())[0], 200)
        self.assertEqual((await self.assign('charlie'))[0], 201)

    async def test_position_change_within_same_department_keeps_scope(self):
        await self.grant(['hr', 'finance'])
        self.assertEqual((await self.move_user('hr-lead'))[0], 200)
        self.assertEqual((await self.assign('charlie'))[0], 201)

    async def test_moving_position_to_another_department_revokes_assigned_accounts(self):
        await self.grant(['hr', 'finance'])
        status, _ = await self.request('PUT', '/api/admin/organization/positions/hr-staff', payload={
            'code': 'HR-STAFF', 'name': 'Staff', 'department_id': 'finance'})
        self.assertEqual(status, 200)
        self.assertEqual((await self.assign('charlie'))[0], 403)
        _, capabilities = await self.request('GET', '/api/access/me')
        self.assertTrue(capabilities['can_assign_tasks'])  # Administrator authority remains intact.

    async def test_filter_department_before_twenty_result_limit(self):
        await self.grant()
        async with self.sessions() as db:
            for index in range(30):
                db.add(User(id=f'outsider-{index}', username=f'outside-{index}', email=f'outside{index}@example.com',
                    full_name=f'A shared {index:02}', position_id='fin-staff', password_hash='unused'))
            alice = await db.get(User, 'alice'); alice.full_name = 'Z shared eligible'
            await db.commit()
        status, results = await self.request('GET', '/api/task-assignees', user='bob', query={'q': 'shared'})
        self.assertEqual(status, 200)
        self.assertEqual([row['id'] for row in results], ['alice'])

    async def test_stale_grant_cannot_restore_rights_after_transfer(self):
        _, initial = await self.grant(['hr', 'finance'])
        await self.move_user('fin-staff')
        self.assertEqual((await self.grant(['hr', 'finance'], initial=initial))[0], 409)

    async def test_unchanged_scope_does_not_write_or_increment_version(self):
        _, first = await self.grant(['finance', 'hr'])
        _, second = await self.grant(['hr', 'finance'], initial=first)
        self.assertEqual(first, second)

    async def test_inactive_recipient_and_revoked_scope_are_rejected_on_submit(self):
        await self.grant(['finance'])
        async with self.sessions() as db:
            user = await db.get(User, 'charlie'); user.is_active = False
            await db.commit()
        self.assertEqual((await self.assign('charlie'))[0], 404)
        await self.grant(permissions=[])
        self.assertEqual((await self.request('GET', '/api/task-assignees', user='bob', query={'q': 'Al'}))[0], 403)
        async with self.sessions() as db:
            self.assertEqual((await db.scalars(select(TaskAssignmentDepartment).where(TaskAssignmentDepartment.user_id == 'bob'))).all(), [])
            self.assertFalse((await db.get(TaskAssignmentPolicy, 'bob')).enabled)

    async def test_open_session_cannot_submit_after_permission_or_scope_revocation(self):
        token = self.tokens['bob']
        await self.grant(['hr', 'finance'])
        self.assertTrue((await self.request('GET', '/api/access/me', user='bob'))[1]['can_assign_tasks'])
        self.assertEqual((await self.assign('charlie'))[0], 201)
        # The user keeps the same authenticated session and stale recipient selection.
        await self.grant(['hr'])
        self.assertEqual((await self.assign('charlie'))[0], 403)
        self.assertEqual((await self.assign('alice'))[0], 201)
        await self.grant(permissions=[])
        self.assertEqual(self.tokens['bob'], token)
        self.assertFalse((await self.request('GET', '/api/access/me', user='bob'))[1]['can_assign_tasks'])
        self.assertEqual((await self.assign('alice'))[0], 403)
        self.assertEqual((await self.request('GET', '/api/task-assignees', user='bob', query={'q': 'Al'}))[0], 403)
        # Regranting works with that same session, without signing in again.
        await self.grant()
        self.assertTrue((await self.request('GET', '/api/access/me', user='bob'))[1]['can_assign_tasks'])
        self.assertEqual((await self.assign('alice'))[0], 201)

    async def test_renaming_department_preserves_scope_and_disabled_home_blocks_assignment(self):
        await self.grant(['hr', 'finance'])
        self.assertEqual((await self.request('PUT', '/api/admin/organization/departments/hr', payload={
            'code': 'HR', 'name': 'Renamed department'}))[0], 200)
        self.assertEqual((await self.assign('charlie'))[0], 201)
        self.assertEqual((await self.request('PUT', '/api/admin/organization/positions/hr-staff', payload={
            'code': 'HR-STAFF', 'name': 'Staff', 'department_id': 'hr', 'is_active': False}))[0], 200)
        self.assertEqual((await self.assign('charlie'))[0], 403)
        # Keeping an existing inactive position must not prevent editing another profile field.
        self.assertEqual((await self.move_user('hr-staff'))[0], 200)

"""Follower invitations use the current department, with an explicit administrator exception."""
from sqlalchemy import select

from tests.support.api_case import ApiTestCase
from app.db.access import UserRole
from app.db.calendar import CalendarEventFollower
from app.db.models import User, TaskFollower
from app.db.organization import Department, Position, TaskAssignmentPolicy, TaskAssignmentDepartment
from app.modules.access.service import CAPABILITY_ROLES, TASKS_ASSIGN, seed_catalog


class DepartmentFollowerTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            db.add(Department(id='other-dept', code='OTHER', name='Other department'))
            await db.flush()
            db.add(Position(id='other-pos', code='OTHER-POS', name='Staff', department_id='other-dept'))
            await db.flush()
            db.add(User(id='charlie', username='charlie', email='charlie@example.com', full_name='Charlie',
                        position_id='other-pos', password_hash='unused'))
            await db.commit()

    async def test_employee_can_find_and_add_same_department_without_assignment_permission(self):
        status, users = await self.request('GET', '/api/colleagues', query={'q': 'bo'})
        self.assertEqual(status, 200)
        self.assertEqual([row['id'] for row in users], ['bob'])
        self.assertEqual((await self.request('GET', '/api/task-assignees', query={'q': 'bo'}))[0], 403)
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['bob']}))[0], 201)
        self.assertEqual((await self.request('POST', payload=self.event_payload(follower_ids=['bob'])))[0], 201)

    async def test_other_department_is_hidden_and_direct_writes_are_rejected(self):
        self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1], [])
        for path, payload in [('/api/tasks', {'title': 'Task', 'follower_ids': ['charlie']}),
                              ('/api/calendar/events', self.event_payload(follower_ids=['charlie']))]:
            with self.subTest(path=path):
                self.assertEqual((await self.request('POST', path, payload=payload))[0], 403)

    async def test_multi_department_assignment_does_not_expand_follower_scope(self):
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id=CAPABILITY_ROLES[TASKS_ASSIGN]))
            db.add(TaskAssignmentPolicy(user_id='alice', enabled=True, mode='selected_departments', home_department_id='fixture-dept'))
            await db.flush()
            db.add(TaskAssignmentDepartment(user_id='alice', department_id='other-dept'))
            await db.commit()
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Assigned', 'assignee_id': 'charlie'}))[0], 201)
        self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1], [])
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['charlie']}))[0], 403)

    async def grant_admin(self):
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='access_admin'))
            await db.commit()

    async def test_admin_can_find_and_add_followers_from_other_departments(self):
        await self.grant_admin()
        status, users = await self.request('GET', '/api/colleagues', query={'q': 'char'})
        self.assertEqual(status, 200)
        self.assertEqual([row['id'] for row in users], ['charlie'])
        for path, payload in [('/api/tasks', {'title': 'Task', 'follower_ids': ['charlie']}),
                              ('/api/calendar/events', self.event_payload(follower_ids=['charlie']))]:
            with self.subTest(path=path):
                status, row = await self.request('POST', path, payload=payload)
                self.assertEqual(status, 201, row)
                self.assertEqual([follower['id'] for follower in row['followers']], ['charlie'])

    async def test_admin_can_add_out_of_department_followers_during_edit(self):
        await self.grant_admin()
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Task'})
        _, event = await self.request('POST', payload=self.event_payload())
        for method, path, payload in [
            ('PATCH', '/api/tasks/' + task['id'], {'follower_ids': ['charlie']}),
            ('PUT', '/api/calendar/events/' + event['id'], self.event_payload(follower_ids=['charlie']))]:
            with self.subTest(path=path):
                status, row = await self.request(method, path, payload=payload)
                self.assertEqual(status, 200, row)
                self.assertEqual([follower['id'] for follower in row['followers']], ['charlie'])

    async def test_admin_does_not_need_a_department_and_can_invite_users_without_positions(self):
        await self.grant_admin()
        async with self.sessions() as db:
            (await db.get(User, 'alice')).position_id = None
            (await db.get(User, 'charlie')).position_id = None
            await db.commit()
        self.assertEqual([row['id'] for row in (await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1]], ['charlie'])
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['charlie']}))[0], 201)

    async def test_admin_cannot_invite_inactive_accounts(self):
        await self.grant_admin()
        async with self.sessions() as db:
            (await db.get(User, 'charlie')).is_active = False
            await db.commit()
        self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1], [])
        for path, payload in [('/api/tasks', {'title': 'Task', 'follower_ids': ['charlie']}),
                              ('/api/calendar/events', self.event_payload(follower_ids=['charlie']))]:
            with self.subTest(path=path):
                self.assertEqual((await self.request('POST', path, payload=payload))[0], 404)

    async def test_revoking_admin_permission_restores_department_scope(self):
        from sqlalchemy import delete
        await self.grant_admin()
        self.assertTrue((await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1])
        async with self.sessions() as db:
            await db.execute(delete(UserRole).where(UserRole.user_id == 'alice', UserRole.role_id == 'access_admin'))
            await db.commit()
        self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'char'}))[1], [])
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['charlie']}))[0], 403)

    async def test_new_out_of_scope_followers_cannot_be_added_during_edit(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Task'})
        _, event = await self.request('POST', payload=self.event_payload())
        self.assertEqual((await self.request('PATCH', '/api/tasks/' + task['id'], payload={'follower_ids': ['charlie']}))[0], 403)
        self.assertEqual((await self.request('PUT', '/api/calendar/events/' + event['id'],
                                            payload=self.event_payload(follower_ids=['charlie'])))[0], 403)

    async def test_legacy_followers_can_be_retained_and_removed_after_department_change(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['bob']})
        _, event = await self.request('POST', payload=self.event_payload(follower_ids=['bob']))
        async with self.sessions() as db:
            (await db.get(User, 'bob')).position_id = 'other-pos'
            await db.commit()
        for followers in (['bob'], []):
            self.assertEqual((await self.request('PATCH', '/api/tasks/' + task['id'], payload={'follower_ids': followers}))[0], 200)
            self.assertEqual((await self.request('PUT', '/api/calendar/events/' + event['id'],
                                                payload=self.event_payload(follower_ids=followers)))[0], 200)
        async with self.sessions() as db:
            self.assertIsNone(await db.scalar(select(TaskFollower).where(TaskFollower.task_id == task['id'])))
            self.assertIsNone(await db.scalar(select(CalendarEventFollower).where(CalendarEventFollower.event_id == event['id'])))

    async def test_no_position_or_inactive_department_cannot_invite(self):
        for scenario in ('no_position', 'inactive_department', 'inactive_position'):
            async with self.sessions() as db:
                actor = await db.get(User, 'alice')
                actor.position_id = None if scenario == 'no_position' else 'fixture-pos'
                (await db.get(Department, 'fixture-dept')).is_active = scenario != 'inactive_department'
                (await db.get(Position, 'fixture-pos')).is_active = scenario != 'inactive_position'
                await db.commit()
            with self.subTest(scenario=scenario):
                self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'bo'}))[1], [])
                self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['bob']}))[0], 403)

    async def test_inactive_recipient_is_never_searchable_or_invitable(self):
        async with self.sessions() as db:
            (await db.get(User, 'bob')).is_active = False
            await db.commit()
        self.assertEqual((await self.request('GET', '/api/colleagues', query={'q': 'bo'}))[1], [])
        self.assertEqual((await self.request('POST', '/api/tasks', payload={'title': 'Task', 'follower_ids': ['bob']}))[0], 404)

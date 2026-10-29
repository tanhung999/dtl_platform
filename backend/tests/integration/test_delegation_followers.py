from tests.support.api_case import ApiTestCase
from app.db.access import AccessPermission, AccessRole, RolePermission, UserRole
from app.db.models import User
from app.db.organization import Department, JobLevel, Position
from app.core.security import create_access_token, hash_password


class DelegationFollowerTests(ApiTestCase):
    async def grant_assignment(self):
        async with self.sessions() as db:
            db.add_all([AccessRole(id='assigner',name='Task assigner'),AccessPermission(code='tasks.assign',name='Assign tasks')])
            await db.flush()
            db.add_all([RolePermission(role_id='assigner',permission_code='tasks.assign'),UserRole(user_id='alice',role_id='assigner')])
            bob = await db.get(User, 'bob'); bob.manager_id = 'alice'
            await db.commit()

    async def test_assignment_permissions_and_assignee_field_policy(self):
        code,_=await self.request('POST','/api/tasks',user='bob',payload={'title':'No','assignee_id':'alice'})
        self.assertEqual(code,403)
        await self.grant_assignment()
        code,task=await self.request('POST','/api/tasks',payload={'title':'Delegated','assignee_id':'bob'})
        self.assertEqual(code,201); self.assertEqual(task['assignee_id'],'bob'); self.assertTrue(task['is_following'])
        code,visible=await self.request('GET','/api/tasks/'+task['id'],user='bob')
        self.assertEqual(code,200); self.assertTrue(visible['can_complete']); self.assertFalse(visible['can_edit'])
        code,_=await self.request('PATCH','/api/tasks/'+task['id'],user='bob',payload={'title':'Forbidden'})
        self.assertEqual(code,403)
        code,done=await self.request('PATCH','/api/tasks/'+task['id'],user='bob',payload={'is_completed':True})
        self.assertEqual(code,200); self.assertTrue(done['is_completed'])

        code, feed = await self.request('GET', '/api/notifications', user='bob')
        self.assertEqual(code, 200)
        assigned = next(item for item in feed['items'] if item['kind'] == 'task_assigned')
        path = '/api/notifications/' + assigned['id']
        self.assertEqual((await self.request('GET', path + '/destination', user='bob'))[1], {'task_id': task['id']})
        self.assertEqual((await self.request('PATCH', path, user='bob', payload={'read': True}))[0], 204)
        self.assertEqual((await self.request('PATCH', path, user='bob', payload={'read': False}))[0], 204)

    async def test_manager_can_only_assign_inside_reporting_tree(self):
        async with self.sessions() as db:
            department = Department(code='TECH', name='Công nghệ')
            manager_level = JobLevel(code='LEAD', name='Quản lý', rank=10, is_management=True)
            db.add_all([department, manager_level]); await db.flush()
            manager_position = Position(code='LEAD-POS', name='Trưởng nhóm', department_id=department.id, job_level_id=manager_level.id)
            db.add(manager_position); await db.flush()
            alice = await db.get(User, 'alice'); bob = await db.get(User, 'bob')
            alice.position_id = manager_position.id; bob.manager_id = 'alice'
            charlie = User(id='charlie', username='charlie', email='charlie@example.com', full_name='Charlie', password_hash=hash_password('test-password'))
            db.add(charlie); await db.commit()
        self.tokens['charlie'] = create_access_token({'sub':'charlie'})
        code, task = await self.request('POST','/api/tasks',payload={'title':'For report','assignee_id':'bob'})
        self.assertEqual(code,201); self.assertEqual(task['assignee_id'],'bob')
        code, _ = await self.request('POST','/api/tasks',payload={'title':'Outside tree','assignee_id':'charlie'})
        self.assertEqual(code,403)
        code, options = await self.request('GET','/api/access/me')
        self.assertEqual(code,200); self.assertTrue(options['can_assign_tasks'])

    async def test_created_by_me_excludes_personal_tasks(self):
        await self.grant_assignment()
        await self.request('POST','/api/tasks',payload={'title':'Personal'})
        await self.request('POST','/api/tasks',payload={'title':'Delegated','assignee_id':'bob'})
        code, page = await self.request('GET','/api/tasks/collection',query={'scope':'created_by_me'})
        self.assertEqual(code,200)
        self.assertEqual([item['title'] for item in page['items']], ['Delegated'])

    async def test_owner_can_add_and_remove_task_followers(self):
        code, task = await self.request('POST', '/api/tasks', payload={
            'title': 'Theo dõi tiến độ', 'follower_ids': ['bob']})
        self.assertEqual(code, 201)
        self.assertEqual([item['id'] for item in task['followers']], ['bob'])
        code, detail = await self.request('GET', '/api/tasks/' + task['id'], user='bob')
        self.assertEqual(code, 200); self.assertTrue(detail['is_following']); self.assertFalse(detail['can_edit'])
        code, updated = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
            'expected_version': task['version'], 'follower_ids': []})
        self.assertEqual(code, 200); self.assertEqual(updated['followers'], [])
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id'], user='bob'))[0], 404)

    async def test_clearing_assignee_returns_to_creator_and_all_explicit_followers_can_be_removed(self):
        await self.grant_assignment()
        code, task = await self.request('POST', '/api/tasks', payload={'title': 'Return to creator', 'assignee_id': 'bob'})
        self.assertEqual(code, 201)
        code, updated = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
            'expected_version': task['version'], 'assignee_id': None, 'follower_ids': []})
        self.assertEqual(code, 200)
        self.assertEqual(updated['assignee_id'], task['user_id'])
        self.assertEqual(updated['followers'], [])
        self.assertTrue(updated['can_edit'])
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id'], user='bob'))[0], 404)

    async def test_omitting_assignee_keeps_existing_recipient_and_non_creator_cannot_clear_it(self):
        await self.grant_assignment()
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Keep recipient', 'assignee_id': 'bob'})
        code, updated = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
            'expected_version': task['version'], 'description': 'Content only'})
        self.assertEqual(code, 200)
        self.assertEqual(updated['assignee_id'], 'bob')
        self.assertEqual((await self.request('PATCH', '/api/tasks/' + task['id'], user='bob', payload={
            'expected_version': updated['version'], 'assignee_id': None}))[0], 403)
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id']))[1]['assignee_id'], 'bob')

    async def test_creator_can_clear_recipient_after_losing_delegation_permission(self):
        await self.grant_assignment()
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Reclaim', 'assignee_id': 'bob'})
        from sqlalchemy import delete
        async with self.sessions() as db:
            await db.execute(delete(UserRole).where(UserRole.user_id == 'alice'))
            await db.commit()
        code, updated = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
            'expected_version': task['version'], 'assignee_id': None})
        self.assertEqual(code, 200)
        self.assertEqual(updated['assignee_id'], 'alice')

    async def test_swap_assignee_and_follower_by_adding_preserves_the_previous_assignee(self):
        await self.grant_assignment()
        async with self.sessions() as db:
            db.add(User(id='charlie', username='charlie', email='charlie@example.com', full_name='Hà', manager_id='alice', password_hash='unused'))
            await db.commit()
        self.tokens['charlie'] = create_access_token({'sub': 'charlie'})
        code, task = await self.request('POST', '/api/tasks', payload={
            'title': 'Swap roles', 'assignee_id': 'bob', 'follower_ids': ['charlie']})
        self.assertEqual(code, 201)
        for recipient, follower in [('charlie', 'bob'), ('bob', 'charlie'), ('charlie', 'bob')]:
            old_version = task['version']
            code, task = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
                'expected_version': old_version, 'assignee_id': recipient, 'follower_ids': ['bob', 'charlie']})
            self.assertEqual(code, 200)
            self.assertEqual(task['assignee_id'], recipient)
            self.assertEqual({item['id'] for item in task['followers']}, {'alice', follower})
            self.assertEqual(task['version'], old_version + 1)
            _, recipient_view = await self.request('GET', '/api/tasks/' + task['id'], user=recipient)
            self.assertTrue(recipient_view['can_complete'])
            _, follower_view = await self.request('GET', '/api/tasks/' + task['id'], user=follower)
            self.assertTrue(follower_view['is_following'])
            self.assertFalse(follower_view['can_complete'])

    async def test_reassignment_without_follower_field_only_removes_the_new_assignee_from_followers(self):
        await self.grant_assignment()
        async with self.sessions() as db:
            db.add(User(id='charlie', username='charlie', email='charlie@example.com', full_name='Hà', manager_id='alice', password_hash='unused'))
            await db.commit()
        _, task = await self.request('POST', '/api/tasks', payload={
            'title': 'Reassign only', 'assignee_id': 'bob', 'follower_ids': ['charlie']})
        code, updated = await self.request('PATCH', '/api/tasks/' + task['id'], payload={
            'expected_version': task['version'], 'assignee_id': 'charlie'})
        self.assertEqual(code, 200)
        self.assertEqual({item['id'] for item in updated['followers']}, {'alice'})
        self.assertEqual((await self.request('GET', '/api/tasks/' + task['id'], user='bob'))[0], 404)

    async def test_private_event_explicit_follower_is_read_only(self):
        async with self.sessions() as db:
            db.add_all([AccessRole(id='sharer',name='Calendar sharer'),AccessPermission(code='calendar.share.manage',name='Share calendar')])
            await db.flush(); db.add_all([RolePermission(role_id='sharer',permission_code='calendar.share.manage'),UserRole(user_id='alice',role_id='sharer')]); await db.commit()
        code,event=await self.request('POST',payload=self.event_payload(is_private=True,follower_ids=['bob']))
        self.assertEqual(code,201)
        code,listed=await self.request('GET',user='bob',query=self.range_query())
        self.assertEqual(code,200); self.assertEqual([row['id'] for row in listed],[event['id']])
        self.assertTrue(listed[0]['is_following']); self.assertFalse(listed[0]['can_edit'])
        code,detail=await self.request('GET','/api/calendar/events/'+event['id'],user='bob')
        self.assertEqual(code,200); self.assertEqual(detail['followers'][0]['id'],'bob')
        code,_=await self.request('PUT','/api/calendar/events/'+event['id'],user='bob',payload=self.event_payload())
        self.assertEqual(code,404)
        code,_=await self.request('POST','/api/calendar/events/'+event['id']+'/unfollow',user='bob')
        self.assertEqual(code,200)
        self.assertEqual((await self.request('GET','/api/calendar/events/'+event['id'],user='bob'))[0],404)

from datetime import datetime, timezone
from sqlalchemy import select
from tests.support.api_case import ApiTestCase
from tests.integration import test_delegation_followers as delegation
from app.db.models import Task
from app.db.task_history import TaskResultHistory


class TaskResultHistoryTests(ApiTestCase):
    grant_assignment = delegation.DelegationFollowerTests.grant_assignment

    async def make(self, **extra):
        code, task = await self.request('POST', '/api/tasks', payload={'title':'Result history', **extra})
        self.assertEqual(code, 201, task)
        return task

    async def history(self, task, user='alice', **query):
        code, page = await self.request('GET', '/api/tasks/'+task['id']+'/result-history', user=user, query=query)
        self.assertEqual(code, 200, page)
        return page

    async def test_complete_reopen_complete_preserves_each_result_and_noops(self):
        await self.grant_assignment()
        task = await self.make(assignee_id='bob')
        path = '/api/tasks/'+task['id']
        for body in ({'is_completed':True,'completion_note':'First result'}, {'is_completed':False}, {'is_completed':True,'completion_note':'Second result'}):
            code, current = await self.request('PATCH', path, user='bob', payload=body)
            self.assertEqual(code, 200, current)
        page = await self.history(task, 'bob')
        self.assertEqual([row['action'] for row in page['items']], ['COMPLETED','REOPENED','COMPLETED'])
        self.assertEqual([row['note'] for row in page['items']], ['Second result',None,'First result'])
        self.assertTrue(all('actor_id' not in row for row in page['items']))
        code, same = await self.request('PATCH', path, user='bob', payload={'is_completed':True,'completion_note':' Second result '})
        self.assertEqual(code, 200, same); self.assertEqual(same['version'], current['version'])
        self.assertEqual((await self.history(task))['total'], 3)
        code, updated = await self.request('PATCH', path, user='bob', payload={'is_completed':True,'completion_note':'Revised result'})
        self.assertEqual(code, 200, updated)
        self.assertEqual((await self.history(task))['items'][0]['action'], 'RESULT_UPDATED')

    async def test_current_access_controls_history_and_deletion(self):
        task = await self.make(follower_ids=['bob'])
        await self.request('PATCH', '/api/tasks/'+task['id'], payload={'is_completed':True,'completion_note':'Private result'})
        self.assertEqual((await self.history(task,'bob'))['total'], 1)
        self.assertEqual((await self.request('PATCH','/api/tasks/'+task['id'],user='bob',payload={'is_completed':False}))[0],403)
        await self.request('PATCH','/api/tasks/'+task['id'],payload={'follower_ids':[]})
        self.assertEqual((await self.request('GET','/api/tasks/'+task['id']+'/result-history',user='bob'))[0],404)
        self.assertEqual((await self.request('GET','/api/tasks/'+task['id']+'/result-history',user=None))[0],401)
        self.assertEqual((await self.request('DELETE','/api/tasks/'+task['id']))[0],204)
        async with self.sessions() as db:
            self.assertEqual((await db.scalars(select(TaskResultHistory))).all(), [])

    async def test_pagination_and_stale_retries_do_not_duplicate(self):
        task = await self.make()
        for index in range(8):
            body = {'is_completed':index%2==0, 'expected_version':index}
            if index%2==0: body['completion_note']=str(index)
            code, row = await self.request('PATCH','/api/tasks/'+task['id'],payload=body)
            self.assertEqual(code,200,row)
        first = await self.history(task,limit=3)
        second = await self.history(task,limit=3,offset=3)
        self.assertEqual(first['total'],8); self.assertTrue(first['has_more'])
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in second['items']})
        code, _ = await self.request('PATCH','/api/tasks/'+task['id'],payload={'expected_version':0,'is_completed':True})
        self.assertEqual(code,409); self.assertEqual((await self.history(task))['total'],8)

    async def test_migration_retains_existing_result_without_changing_task(self):
        from app.db.migrations.task_result_history import migrate_task_result_history
        at = datetime(2026,11,2,2,tzinfo=timezone.utc)
        async with self.sessions() as db:
            task = Task(user_id='alice',title='Legacy',is_completed=True,completion_note='Keep existing result',version=4,completed_at=at)
            db.add(task); await db.commit(); task_id=task.id
            before=(task.version,task.updated_at,task.completion_note,task.completed_at)
        async with self.engine.begin() as conn:
            await migrate_task_result_history(conn); await migrate_task_result_history(conn)
        async with self.sessions() as db:
            task=await db.get(Task,task_id)
            self.assertEqual((task.version,task.updated_at,task.completion_note,task.completed_at),before)
            records=(await db.scalars(select(TaskResultHistory).where(TaskResultHistory.task_id==task_id))).all()
            self.assertEqual(len(records),1); self.assertTrue(records[0].is_snapshot)
            self.assertEqual(records[0].note,'Keep existing result'); self.assertEqual(records[0].occurred_at,at)

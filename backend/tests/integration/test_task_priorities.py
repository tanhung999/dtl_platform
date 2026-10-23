from sqlalchemy import select
from tests.support.api_case import ApiTestCase
from app.db.models import Task
from app.db.migrations.task_priorities import migrate_task_priorities


class TaskPrioritiesTest(ApiTestCase):
    async def test_create_and_edit_legacy_high_use_medium(self):
        status, task = await self.request('POST', '/api/tasks', payload={'title': 'Priority', 'priority': 'HIGH'})
        self.assertEqual(status, 201)
        self.assertEqual(task['priority'], 'MEDIUM')
        for priority in ['URGENT', 'LOW', 'MEDIUM', 'HIGH']:
            status, task = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'priority': priority, 'expected_version': task['version']})
            self.assertEqual(status, 200)
            self.assertEqual(task['priority'], 'MEDIUM' if priority == 'HIGH' else priority)

    async def test_migration_preserves_deadlines_and_other_priorities(self):
        async with self.sessions() as db:
            for priority in ['HIGH', 'MEDIUM', 'URGENT', 'LOW']:
                db.add(Task(id=priority, user_id='alice', title=priority, priority=priority, due_date='2099-01-01', due_time='09:00', version=3))
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_task_priorities(conn)
            await migrate_task_priorities(conn)
        async with self.sessions() as db:
            tasks = {task.id: task for task in (await db.scalars(select(Task))).all()}
            self.assertEqual(tasks['HIGH'].priority, 'MEDIUM')
            self.assertEqual(tasks['HIGH'].version, 4)
            for priority, task in tasks.items():
                self.assertEqual((task.due_date, task.due_time), ('2099-01-01', '09:00'))
                if priority != 'HIGH':
                    self.assertEqual(task.priority, priority)
                    self.assertEqual(task.version, 3)

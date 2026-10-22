from sqlalchemy import select
from tests.support.api_case import ApiTestCase
from app.db.models import Task
from app.db.migrations.resolved_legacy_dates import migrate_resolved_legacy_dates


class ResolvedLegacyDatesTests(ApiTestCase):
    async def test_cleanup_keeps_unresolved_originals_and_is_repeatable(self):
        async with self.sessions() as db:
            db.add_all([
                Task(id='resolved', user_id='alice', title='Resolved', due_date='2099-01-01', legacy_due_date='old', version=2, deadline_version=1),
                Task(id='cleared', user_id='alice', title='Cleared', legacy_due_date='old', version=2, deadline_version=1),
                Task(id='unresolved', user_id='alice', title='Unresolved', legacy_due_date='invalid original', version=2, deadline_version=0),
            ])
            await db.commit()
        async with self.engine.begin() as conn:
            await migrate_resolved_legacy_dates(conn)
            await migrate_resolved_legacy_dates(conn)
        async with self.sessions() as db:
            tasks = {task.id: task for task in (await db.scalars(select(Task))).all()}
            self.assertIsNone(tasks['resolved'].legacy_due_date)
            self.assertIsNone(tasks['cleared'].legacy_due_date)
            self.assertEqual(tasks['resolved'].due_date, '2099-01-01')
            self.assertEqual(tasks['resolved'].version, 3)
            self.assertEqual(tasks['unresolved'].legacy_due_date, 'invalid original')
            self.assertEqual(tasks['unresolved'].version, 2)

    async def test_setting_a_valid_deadline_discards_only_the_legacy_hint(self):
        async with self.sessions() as db:
            db.add(Task(id='legacy', user_id='alice', title='Legacy', legacy_due_date='invalid original'))
            await db.commit()
        status, task = await self.request('PATCH', '/api/tasks/legacy', payload={'due_date':'2099-01-01','expected_version':0})
        self.assertEqual(status, 200)
        self.assertIsNone(task['legacy_due_date'])
        self.assertEqual(str(task['due_date']), '2099-01-01')

"""Đối chiếu payload thông báo và phạm vi invalidation khi sửa sự kiện."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from sqlalchemy import event, select
from tests.support.api_case import ApiTestCase
from app.db.models import Task
from app.db.notifications import Notification
from app.core.workspace_versions import read_versions

NOW = datetime(2026, 10, 20, 8, tzinfo=timezone.utc)

class FeedProjectionTests(ApiTestCase):
    async def test_projected_feed_matches_full_tasks_without_lazy_queries(self):
        states = ('active', 'completed', 'changed', 'no-deadline', 'overdue', 'deleted', 'external')
        async with self.sessions() as db:
            for i, state in enumerate(states):
                task_id = 'feed-task-'+str(i) if state not in ('deleted', 'external') else None
                if task_id:
                    db.add(Task(id=task_id,user_id='alice',title='Current title differs from saved notice',description='large '*10000,
                        due_date=None if state=='no-deadline' else '2026-10-20',deadline_version=2 if state=='changed' else 1,is_completed=state=='completed'))
                db.add(Notification(id='feed-notice-'+str(i),user_id='alice',source='workflows' if state=='external' else 'platform',event_key='feed-'+str(i),fingerprint='unused',
                    kind='info',title='Saved title '+state,body='Saved body',resource_type='record' if state=='external' else 'task',resource_id=task_id or '',task_id=task_id,
                    deadline_version=1,due_at=NOW+timedelta(hours=-1 if state=='overdue' else 1),occurred_at=NOW,created_at=NOW-timedelta(minutes=i),
                    read_at=NOW if state=='changed' else None,dismissed_at=NOW if state=='no-deadline' else None))
            await db.commit()
        queries=[{}, {'filter':'unread'}, {'filter':'hidden'}, {'source':'platform'}, {'limit':2}]
        baseline = lambda: select(Notification, Task).outerjoin(Task, Task.id == Notification.task_id)
        with patch('app.modules.notifications.router.utcnow',return_value=NOW):
            with patch('app.modules.notifications.router.select_feed',side_effect=baseline):
                before=[await self.request('GET','/api/notifications',query=query) for query in queries]
                summary_before=await self.request('GET','/api/notifications/summary')
                cursor=before[-1][1]['next_cursor']
                next_before=await self.request('GET','/api/notifications',query={'before':cursor,'limit':2})
            sql=[]
            def trace(conn,cursor,statement,parameters,context,many):sql.append(statement)
            event.listen(self.engine.sync_engine,'before_cursor_execute',trace)
            try:
                after=[await self.request('GET','/api/notifications',query=query) for query in queries]
                self.assertEqual(after,before)
                self.assertEqual(await self.request('GET','/api/notifications/summary'),summary_before)
                self.assertEqual(await self.request('GET','/api/notifications',query={'before':cursor,'limit':2}),next_before)
            finally:event.remove(self.engine.sync_engine,'before_cursor_execute',trace)
        feed_sql=[statement for statement in sql if 'LEFT OUTER JOIN tasks' in statement]
        self.assertEqual(len(feed_sql),7)
        for statement in feed_sql:
            for field in ('tasks.description','tasks.title','tasks.due_time','tasks.priority'):
                self.assertNotIn(field,statement)
        self.assertFalse(any('FROM tasks' in statement and 'LEFT OUTER JOIN tasks' not in statement and 'notifications' not in statement for statement in sql), 'No deferred per-task reads')
        items=before[0][1]['items']+before[2][1]['items']
        self.assertEqual({item['state'] for item in items},{'active','completed','changed','overdue','deleted'})

class CalendarInvalidationTests(ApiTestCase):
    async def versions(self):
        async with self.sessions() as db:return await read_versions(db,'alice')

    async def test_ordinary_event_create_edit_time_delete_never_changes_notes_version(self):
        before=await self.versions()
        status,row=await self.request('POST',payload=self.event_payload());self.assertEqual(status,201)
        self.assertEqual((await self.versions())['notes'],before['notes'])
        status,row=await self.request('PUT',f'/api/calendar/events/{row["id"]}',payload=self.event_payload(title='Renamed'));self.assertEqual(status,200)
        status,row=await self.request('PUT',f'/api/calendar/events/{row["id"]}',payload=self.event_payload(ends_at='2026-10-12T10:30:00+07:00',expected_updated_at=row['updated_at']));self.assertEqual(status,200)
        self.assertEqual((await self.versions())['notes'],before['notes'])
        status,_=await self.request('DELETE',f'/api/calendar/events/{row["id"]}');self.assertEqual(status,204)
        after=await self.versions();self.assertEqual(after['notes'],before['notes']);self.assertEqual(after['calendar'],before['calendar']+4)

    async def test_linked_event_edit_time_privacy_and_delete_notify_notes(self):
        from app.modules.access.service import seed_catalog
        from app.db.access import UserRole
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='calendar_sharer'))
            await db.commit()
        status,note=await self.request('POST','/api/notes',payload={'title':'Meeting note','content':'Keep this content','calendar_schedule':{'starts_at':'2026-10-12T09:00:00+07:00','ends_at':'2026-10-12T10:00:00+07:00','is_all_day':False}});self.assertEqual(status,201)
        event_id=note['calendar_schedule']['event_id'];version=(await self.versions())['notes']
        status,row=await self.request('PUT',f'/api/calendar/events/{event_id}',payload=self.event_payload(title='Changed appointment'));self.assertEqual(status,200)
        self.assertEqual((await self.versions())['notes'],version+1)
        status,row=await self.request('PUT',f'/api/calendar/events/{event_id}',payload=self.event_payload(ends_at='2026-10-12T10:30:00+07:00',expected_updated_at=row['updated_at']));self.assertEqual(status,200)
        self.assertEqual((await self.versions())['notes'],version+2)
        status,row=await self.request('PUT',f'/api/calendar/events/{event_id}',payload=self.event_payload(is_private=True));self.assertEqual(status,200)
        self.assertEqual((await self.versions())['notes'],version+3)
        status,_=await self.request('DELETE',f'/api/calendar/events/{event_id}');self.assertEqual(status,204)
        self.assertEqual((await self.versions())['notes'],version+4)
        status,remaining=await self.request('GET',f'/api/notes/{note["id"]}');self.assertEqual(status,200)
        self.assertIsNone(remaining['calendar_schedule']);self.assertEqual(remaining['content'],'Keep this content')

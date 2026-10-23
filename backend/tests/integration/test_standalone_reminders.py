"""Remind an undated Task or unscheduled Note without creating a calendar entry."""
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from tests.integration import test_user_reminders as reminders
from app.db.notifications import NotificationJob as Job
from app.db.calendar import CalendarEvent
from app.db.migrations.standalone_reminders import migrate_standalone_reminders

NOW, START = reminders.NOW, reminders.START


class StandaloneReminderTests(ApiTestCase):
    tick = reminders.UserReminderTests.tick
    jobs = reminders.UserReminderTests.jobs

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.notifications.scheduling.utcnow','app.modules.tasks.router.utcnow'):
            clock=patch(name,return_value=NOW); clock.start(); self.addCleanup(clock.stop)

    async def create_note(self, **extra):
        code,note=await self.request('POST','/api/notes',payload={'title':'Unscheduled note','reminder_at':START.isoformat(),**extra})
        self.assertEqual(code,201,note)
        return note

    async def test_undated_task_reminds_once_without_becoming_overdue_or_creating_event(self):
        code,task=await self.request('POST','/api/tasks',payload={'title':'No deadline','reminder_at':START.isoformat()})
        self.assertEqual(code,201,task); self.assertIsNone(task['due_date'])
        self.assertEqual(await self.tick(START),1); self.assertEqual(await self.tick(START),0)
        items=(await self.request('GET','/api/notifications'))[1]['items']
        self.assertEqual(len(items),1); self.assertEqual(items[0]['state'],'active'); self.assertIsNone(items[0]['due_at'])
        self.assertIn('Nhắc lúc',items[0]['body'])
        self.assertEqual((await self.request('GET',f"/api/notifications/{items[0]['id']}/destination"))[1],{'task_id':task['id']})

    async def test_undated_task_edit_noop_clear_deadline_and_past_offset_guards(self):
        code,task=await self.request('POST','/api/tasks',payload={'title':'No deadline','reminder_at':START.isoformat()})
        path='/api/tasks/'+task['id']
        code,same=await self.request('PATCH',path,payload={'title':task['title'],'reminder_at':START.isoformat()})
        self.assertEqual(same['version'],task['version'])
        for extra in ({'reminder_at':NOW.isoformat()},{'reminder_minutes':30}):
            self.assertEqual((await self.request('POST','/api/tasks',payload={'title':'Invalid',**extra}))[0],422)
        code,dated=await self.request('PATCH',path,payload={'due_date':'2026-10-22'})
        self.assertEqual(code,200,dated)
        code,cleared=await self.request('PATCH',path,payload={'due_date':None})
        self.assertEqual(code,200,cleared); self.assertIsNone(cleared['due_date']); self.assertIsNotNone(cleared['reminder_at'])
        self.assertEqual(len(await self.jobs()),1)

    async def test_unscheduled_note_reminds_once_and_opens_note_not_calendar(self):
        note=await self.create_note()
        self.assertIsNone(note['calendar_schedule'])
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarEvent)),0)
        jobs=await self.jobs(); self.assertEqual(jobs[0].note_id,note['id']); self.assertIsNone(jobs[0].event_id)
        self.assertEqual(await self.tick(START),1); self.assertEqual(await self.tick(START),0)
        item=(await self.request('GET','/api/notifications'))[1]['items'][0]
        self.assertEqual(item['resource_type'],'note'); self.assertEqual(item['state'],'active')
        self.assertEqual((await self.request('GET',f"/api/notifications/{item['id']}/destination"))[1],{'note_id':note['id']})
        self.assertEqual((await self.request('GET',f"/api/notifications/{item['id']}/destination",user='bob'))[0],404)
        await self.request('DELETE','/api/notes/'+note['id'])
        item=(await self.request('GET','/api/notifications'))[1]['items'][0]
        self.assertEqual(item['state'],'deleted')

    async def test_note_noop_retry_and_invalid_past_are_atomic(self):
        key=str(uuid4()); note=await self.create_note(request_id=key)
        retried=await self.create_note(request_id=key); self.assertEqual(note['id'],retried['id'])
        code,same=await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'reminder_at':START.isoformat()})
        self.assertEqual(code,200,same); self.assertEqual(same['version'],note['version'])
        code,_=await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'title':'Must roll back','reminder_at':NOW.isoformat()})
        self.assertEqual(code,422)
        self.assertEqual((await self.request('GET','/api/notes/'+note['id']))[1]['title'],note['title'])
        for extra in ({'reminder_at':NOW.isoformat()},{'reminder_at':'2026-10-20T09:00:00'},{'reminder_at':None,'reminder_minutes':30}):
            code,_=await self.request('POST','/api/notes',payload={'title':'Invalid',**extra}); self.assertEqual(code,422)
        self.assertEqual(len(await self.jobs()),1)

    async def test_archive_restore_disable_and_delete_cancel_standalone_jobs(self):
        note=await self.create_note(); path='/api/notes/'+note['id']
        async def edit(**fields):
            current=(await self.request('GET',path))[1]
            code,row=await self.request('PATCH',path,payload={'expected_version':current['version'],**fields})
            self.assertEqual(code,200,row)
            return row
        await edit(is_archived=True); self.assertEqual(await self.jobs(),[])
        await edit(is_archived=False); self.assertEqual(len(await self.jobs()),1)
        await edit(reminder_at=None); self.assertEqual(await self.jobs(),[])
        await edit(reminder_at=START.isoformat()); self.assertEqual(len(await self.jobs()),1)
        await self.request('DELETE',path); self.assertEqual(await self.jobs(),[])

    async def test_attaching_note_cancels_old_job_and_keeps_only_appointment_reminder(self):
        note=await self.create_note()
        payload={'starts_at':'2026-10-20T01:00:00Z','ends_at':'2026-10-20T03:00:00Z','is_all_day':False,'reminder_at':START.isoformat()}
        code,row=await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'calendar_schedule':payload})
        self.assertEqual(code,200,row); self.assertIsNone(row['reminder_at'])
        jobs=await self.jobs(); self.assertEqual(len(jobs),1); self.assertIsNone(jobs[0].note_id); self.assertIsNotNone(jobs[0].event_id)
        await self.tick(START)
        self.assertEqual(len((await self.request('GET','/api/notifications'))[1]['items']),1)

    async def test_migration_can_repeat_without_modifying_note_content(self):
        note=await self.create_note()
        async with self.engine.begin() as conn:
            await migrate_standalone_reminders(conn); await migrate_standalone_reminders(conn)
        current=(await self.request('GET','/api/notes/'+note['id']))[1]
        self.assertEqual(current,note)

    async def test_calendar_sharing_does_not_expose_unscheduled_note_or_undated_task(self):
        from app.db.access import UserRole, CalendarShare
        from app.modules.access.service import seed_catalog
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice',role_id='calendar_sharer'))
            db.add(CalendarShare(owner_id='alice',viewer_id='bob',share_events=True,share_tasks=True,share_notes=True))
            await db.commit()
        await self.create_note()
        code,row=await self.request('POST','/api/tasks',payload={'title':'Undated','reminder_at':START.isoformat()})
        self.assertEqual(code,201,row)
        await self.tick(START)
        self.assertEqual(len((await self.request('GET','/api/notifications'))[1]['items']),2)
        self.assertEqual((await self.request('GET','/api/notifications',user='bob'))[1]['items'],[])

    async def test_elapsed_task_event_and_scheduled_note_allow_future_custom_reminders(self):
        schedule={'starts_at':'2000-01-01T02:00:00Z','ends_at':'2000-01-01T03:00:00Z','is_all_day':False,'reminder_at':START.isoformat()}
        code,task=await self.request('POST','/api/tasks',payload={'title':'Past task','due_date':'2000-01-01','due_time':'09:00','reminder_at':START.isoformat()})
        self.assertEqual(code,201,task)
        code,event=await self.request('POST','/api/calendar/events',payload={'title':'Past event',**schedule})
        self.assertEqual(code,201,event)
        code,note=await self.request('POST','/api/notes',payload={'title':'Past note','calendar_schedule':schedule})
        self.assertEqual(code,201,note)
        self.assertEqual(len(await self.jobs()),3)
        self.assertEqual(await self.tick(START),3); self.assertEqual(await self.tick(START),0)
        notices=(await self.request('GET','/api/notifications'))[1]['items']
        self.assertEqual({n['resource_type'] for n in notices},{'task','event','note'})
        self.assertEqual((await self.request('GET','/api/tasks/'+task['id']))[1]['due_date'],'2000-01-01')
        self.assertTrue((await self.request('GET','/api/calendar/events/'+event['id']))[1]['starts_at'].startswith('2000-01-01'))
        self.assertTrue((await self.request('GET','/api/notes/'+note['id']))[1]['calendar_schedule']['starts_at'].startswith('2000-01-01'))

    async def test_elapsed_items_still_reject_new_past_reminders_and_relative_offsets(self):
        for config in ({'reminder_at':NOW.isoformat()},{'reminder_minutes':30}):
            code,_=await self.request('POST','/api/tasks',payload={'title':'Invalid past','due_date':'2000-01-01','due_time':'09:00',**config})
            self.assertEqual(code,422)
            schedule={'starts_at':'2000-01-01T02:00:00Z','ends_at':'2000-01-01T03:00:00Z','is_all_day':False,**config}
            code,_=await self.request('POST','/api/calendar/events',payload={'title':'Invalid past',**schedule}); self.assertEqual(code,422)
            code,_=await self.request('POST','/api/notes',payload={'title':'Invalid past','calendar_schedule':schedule}); self.assertEqual(code,422)
        self.assertEqual(await self.jobs(),[])

    async def test_editing_expired_task_reminder_replaces_queue_without_rescheduling(self):
        code,task=await self.request('POST','/api/tasks',payload={'title':'Past task','due_date':'2000-01-01','due_time':'09:00'})
        self.assertEqual(code,201,task)
        from datetime import timedelta
        for stamp in (START, START+timedelta(hours=1)):
            code,task=await self.request('PATCH','/api/tasks/'+task['id'],payload={'reminder_at':stamp.isoformat()})
            self.assertEqual(code,200,task); self.assertEqual(task['due_date'],'2000-01-01')
        jobs=await self.jobs(); self.assertEqual(len(jobs),1); self.assertEqual(jobs[0].scheduled_at,START+timedelta(hours=1))
        self.assertEqual(await self.tick(START),0)
        self.assertEqual(await self.tick(START+timedelta(hours=1)),1)

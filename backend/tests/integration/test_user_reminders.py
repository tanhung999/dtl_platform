"""Nhắc theo lựa chọn: không nhắc ngầm, đúng phiên bản, bền vững và không phát lại."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.notifications import NotificationJob as Job, Notification
from app.modules.notifications.worker import deliver_batch

UTC = timezone.utc
NOW = datetime(2026, 10, 18, 0, tzinfo=UTC)
START = datetime(2026, 10, 20, 2, tzinfo=UTC)

class UserReminderTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.clocks = [patch(name, return_value=NOW) for name in (
            'app.modules.notifications.scheduling.utcnow', 'app.modules.tasks.router.utcnow')]
        for clock in self.clocks: clock.start(); self.addCleanup(clock.stop)

    async def task(self, **extra):
        code, row = await self.request('POST', '/api/tasks', payload={
            'title': 'Task reminder', 'due_date': '2026-10-20', 'due_time': '09:00', **extra})
        self.assertEqual(code, 201, row)
        return row

    async def event(self, **extra):
        code, row = await self.request('POST', payload=self.event_payload(
            starts_at=START.isoformat(), ends_at=(START+timedelta(hours=1)).isoformat(), **extra))
        self.assertEqual(code, 201, row)
        return row

    async def note(self, **extra):
        code, row = await self.request('POST', '/api/notes', payload={'title': 'Note reminder',
            'calendar_schedule': {'starts_at': START.isoformat(), 'ends_at': (START+timedelta(hours=1)).isoformat(),
                'is_all_day': False, **extra}})
        self.assertEqual(code, 201, row)
        return row

    async def jobs(self):
        async with self.sessions() as db:
            return (await db.scalars(select(Job).where(Job.processed_at.is_(None)))).all()

    async def tick(self, now):
        async with self.sessions() as db:
            count = await deliver_batch(db, now); await db.commit(); return count

    async def test_default_none_for_tasks_events_notes(self):
        task, event, note = await self.task(), await self.event(), await self.note()
        self.assertIsNone(task['reminder_minutes']); self.assertIsNone(event['reminder_at'])
        self.assertIsNone(note['calendar_schedule']['reminder_minutes'])
        self.assertEqual(await self.jobs(), [])
        self.assertEqual(await self.tick(START+timedelta(days=2)), 0)
        self.assertEqual((await self.request('GET', '/api/notifications'))[1]['items'], [])

    async def test_presets_exact_time_once_and_private_offline_catchup(self):
        for minutes in (0, 15, 30, 60, 1440):
            await self.task(reminder_minutes=minutes)
        jobs = await self.jobs()
        self.assertEqual({j.scheduled_at for j in jobs}, {START-timedelta(minutes=m) for m in (0,15,30,60,1440)})
        self.assertEqual(await self.tick(START-timedelta(days=2)), 0)
        self.assertEqual(await self.tick(START+timedelta(days=3)), 5)
        self.assertEqual(await self.tick(START+timedelta(days=3)), 0)
        feed = (await self.request('GET', '/api/notifications'))[1]['items']
        self.assertEqual(len(feed), 5); self.assertEqual({n['kind'] for n in feed}, {'task.reminder'})
        self.assertEqual((await self.request('GET', '/api/notifications', user='bob'))[1]['items'], [])
        self.assertEqual((await self.request('GET', '/api/notifications/summary'))[1]['unread_count'], 5)

    async def test_custom_all_day_timezone_and_validation(self):
        at = '2026-10-20T09:00:00+07:00'
        task = await self.task(due_time=None, reminder_at=at)
        note = await self.note(is_all_day=True, starts_at='2026-10-19T17:00:00Z', ends_at='2026-10-20T17:00:00Z', reminder_at=at)
        jobs = await self.jobs()
        self.assertEqual({j.scheduled_at for j in jobs}, {START})
        for payload in ({'reminder_minutes': 30, 'reminder_at': at}, {'reminder_minutes': -1}, {'reminder_minutes': 20},
                        {'reminder_at': '2026-10-20T09:00:00'}, {'reminder_at': NOW.isoformat()},
                        {'reminder_at': '2026-10-20T10:00:00+07:00'}, {'due_time': None, 'reminder_minutes': 30}):
            code, _ = await self.request('POST', '/api/tasks', payload={'title': 'Invalid', 'due_date': '2026-10-20', 'due_time': '09:00', **payload})
            self.assertEqual(code, 422, payload)
        self.assertEqual(len(await self.jobs()), 2)  # Rejected writes roll back their rows and jobs.
        await self.tick(START)
        feed = (await self.request('GET', '/api/notifications'))[1]['items']
        self.assertEqual({r['resource_type'] for r in feed}, {'task', 'note'})
        for item in feed:
            code, dest = await self.request('GET', f"/api/notifications/{item['id']}/destination")
            self.assertEqual(code, 200, dest)
            self.assertEqual(dest, {'task_id':task['id']} if item['resource_type']=='task' else {'note_id':note['id']})

    async def test_content_only_noop_and_end_time_do_not_requeue(self):
        event = await self.event(reminder_minutes=30)
        job = (await self.jobs())[0]
        await self.tick(START)
        with patch('app.modules.notifications.scheduling.utcnow', return_value=START+timedelta(days=1)):
            code, edited = await self.request('PUT', '/api/calendar/events/'+event['id'], payload={
                **self.event_payload(starts_at=event['starts_at'], ends_at=(START+timedelta(hours=2)).isoformat()), 'title':'Edited'})
        self.assertEqual(code, 200, edited)
        self.assertEqual(await self.jobs(), [])
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(Job)), 1)
        feed = (await self.request('GET', '/api/notifications'))[1]['items']
        self.assertEqual((await self.request('GET', '/api/notifications/'+feed[0]['id']+'/destination'))[1], {'event_id':event['id']})

    async def test_reschedule_replaces_pending_offset_and_undo_restores_selection(self):
        task = await self.task(reminder_minutes=30)
        original = (await self.jobs())[0]
        code, moved = await self.request('POST', '/api/schedule-changes/task/'+task['id'], payload={
            'request_id':str(uuid4()), 'expected_version':task['version'], 'due_date':'2026-10-22', 'due_time':'09:00'})
        self.assertEqual(code, 200, moved)
        replacement = (await self.jobs())[0]
        self.assertNotEqual(replacement.event_key, original.event_key)
        self.assertEqual(replacement.scheduled_at, START+timedelta(days=2, minutes=-30))
        code, undone = await self.request('POST', '/api/schedule-changes/records/'+moved['id']+'/undo')
        self.assertEqual(code, 200, undone)
        self.assertEqual((await self.jobs())[0].scheduled_at, START-timedelta(minutes=30))

    async def test_clear_complete_reopen_and_late_restore_no_replay(self):
        task = await self.task(reminder_minutes=60); path='/api/tasks/'+task['id']
        await self.request('PATCH', path, payload={'is_completed':True})
        self.assertEqual(await self.jobs(), [])
        await self.request('PATCH', path, payload={'is_completed':False})
        self.assertEqual(len(await self.jobs()), 1)
        await self.request('PATCH', path, payload={'is_completed':True})
        with patch('app.modules.notifications.scheduling.utcnow', return_value=START+timedelta(days=1)):
            code, restored = await self.request('PATCH', path, payload={'is_completed':False})
        self.assertEqual(code, 200, restored); self.assertEqual(await self.jobs(), [])
        code, _ = await self.request('PATCH', path, payload={'due_date':None})
        self.assertEqual(code, 200); self.assertEqual(await self.jobs(), [])

    async def test_note_archive_restore_delete_and_event_delete_cancel_jobs(self):
        note = await self.note(reminder_minutes=15); path='/api/notes/'+note['id']
        code, archived = await self.request('PATCH', path, payload={'expected_version':note['version'], 'is_archived':True})
        self.assertEqual(code, 200, archived); self.assertEqual(await self.jobs(), [])
        code, restored = await self.request('PATCH', path, payload={'expected_version':archived['version'], 'is_archived':False})
        self.assertEqual(code, 200, restored); self.assertEqual(len(await self.jobs()), 1)
        self.assertEqual((await self.request('DELETE', path))[0], 204); self.assertEqual(await self.jobs(), [])
        event = await self.event(reminder_minutes=30)
        self.assertEqual((await self.request('DELETE', '/api/calendar/events/'+event['id']))[0], 204)
        self.assertEqual(await self.jobs(), [])

    async def test_custom_stays_fixed_offset_switch_clear_and_guards(self):
        task=await self.task(reminder_at=(START-timedelta(hours=2)).isoformat()); path='/api/tasks/'+task['id']
        code, moved=await self.request('PATCH', path, payload={'due_date':'2026-10-22'})
        self.assertEqual(code, 200, moved); self.assertEqual((await self.jobs())[0].scheduled_at, START-timedelta(hours=2))
        code, switched=await self.request('PATCH', path, payload={'reminder_minutes':30})
        self.assertEqual(code, 200, switched); self.assertIsNone(switched['reminder_at'])
        self.assertEqual((await self.request('PATCH', path, payload={'reminder_minutes':60, 'expected_version':0}))[0],409)
        self.assertEqual((await self.request('PATCH', path, user='bob', payload={'reminder_minutes':60}))[0],404)
        code, cleared=await self.request('PATCH', path, payload={'reminder_minutes':None, 'reminder_at':None})
        self.assertEqual(code, 200, cleared); self.assertEqual(await self.jobs(), [])

    async def test_elapsed_selection_content_allowed_schedule_change_rejected_atomically(self):
        task=await self.task(reminder_minutes=30); path='/api/tasks/'+task['id']
        with patch('app.modules.notifications.scheduling.utcnow', return_value=START+timedelta(days=1)):
            code, edited=await self.request('PATCH', path, payload={'title':'Allowed'})
            self.assertEqual(code, 200, edited)
            code, rejected=await self.request('PATCH', path, payload={'due_date':'2026-10-19'})
            self.assertEqual(code, 422, rejected)
        current=(await self.request('GET', path))[1]
        self.assertEqual(current['due_date'],task['due_date']); self.assertEqual(current['title'],'Allowed')
        self.assertEqual(len(await self.jobs()),1)

    async def test_undo_elapsed_reminder_restores_without_replaying(self):
        task=await self.task(reminder_minutes=30)
        code, moved=await self.request('POST', '/api/schedule-changes/task/'+task['id'], payload={
            'request_id':str(uuid4()), 'expected_version':task['version'], 'due_date':'2026-10-22', 'due_time':'09:00'})
        self.assertEqual(code,200,moved)
        with patch('app.modules.notifications.scheduling.utcnow', return_value=START+timedelta(days=1)):
            code, undone=await self.request('POST', '/api/schedule-changes/records/'+moved['id']+'/undo')
        self.assertEqual(code,200,undone); self.assertEqual(await self.jobs(),[])
        self.assertEqual(await self.tick(START+timedelta(days=3)),0)

    async def test_note_and_event_reschedule_switch_and_delivered_history(self):
        note=await self.note(reminder_minutes=30)
        schedule=note['calendar_schedule']
        code, moved=await self.request('PATCH','/api/notes/'+note['id'],payload={
            'expected_version':note['version'], 'calendar_schedule':{**schedule,
                'starts_at':(START+timedelta(days=1)).isoformat(), 'ends_at':(START+timedelta(days=1,hours=1)).isoformat()}})
        self.assertEqual(code,200,moved)
        self.assertEqual((await self.jobs())[0].scheduled_at,START+timedelta(days=1,minutes=-30))
        await self.tick(START+timedelta(days=2))
        item=(await self.request('GET','/api/notifications'))[1]['items'][0]
        self.assertEqual(item['resource_type'],'note')
        await self.request('DELETE','/api/calendar/events/'+schedule['event_id'])
        item=(await self.request('GET','/api/notifications'))[1]['items'][0]
        self.assertEqual(item['state'],'deleted')
        self.assertEqual((await self.request('GET',f"/api/notifications/{item['id']}/destination"))[0],404)

    async def test_replacing_or_cancelling_reminder_invalidates_snooze(self):
        task=await self.task(reminder_minutes=1440)
        await self.tick(START-timedelta(days=1))
        item=(await self.request('GET','/api/notifications'))[1]['items'][0]
        with patch('app.modules.notifications.router.utcnow',return_value=START-timedelta(days=1)):
            self.assertEqual((await self.request('POST',f"/api/notifications/{item['id']}/snooze"))[0],204)
            await self.request('PATCH','/api/tasks/'+task['id'],payload={'reminder_minutes':None,'reminder_at':None})
            self.assertEqual((await self.request('POST',f"/api/notifications/{item['id']}/snooze"))[0],409)
        self.assertEqual(await self.jobs(),[])

    async def test_selected_reminder_creation_retry_is_idempotent_and_rejects_changed_selection(self):
        for endpoint, payload, key in (
            ('/api/tasks',{'title':'Retry task','due_date':'2026-10-20','due_time':'09:00','reminder_minutes':30},'client_request_id'),
            ('/api/calendar/events',self.event_payload(starts_at=START.isoformat(),ends_at=(START+timedelta(hours=1)).isoformat(),reminder_minutes=30),'client_request_id'),
            ('/api/notes',{'title':'Retry note','calendar_schedule':{'starts_at':START.isoformat(),'ends_at':(START+timedelta(hours=1)).isoformat(),'is_all_day':False,'reminder_minutes':30}},'request_id')):
            payload={**payload,key:str(uuid4())}
            code,first=await self.request('POST',endpoint,payload=payload)
            self.assertEqual(code,201,first)
            code,second=await self.request('POST',endpoint,payload=payload)
            self.assertEqual(code,201,second);self.assertEqual(first['id'],second['id'])
            changed={**payload,**({'calendar_schedule':{**payload['calendar_schedule'],'reminder_minutes':60}} if endpoint=='/api/notes' else {'reminder_minutes':60})}
            self.assertEqual((await self.request('POST',endpoint,payload=changed))[0],409)
        self.assertEqual(len(await self.jobs()),3)

    async def test_custom_reminders_during_event_and_note_before_exclusive_end(self):
        during = START + timedelta(minutes=45)
        with patch('app.modules.notifications.scheduling.utcnow', return_value=START+timedelta(minutes=30)):
            event = await self.event(reminder_at=during.isoformat())
            note = await self.note(reminder_at=during.isoformat())
        jobs = await self.jobs()
        self.assertEqual({job.scheduled_at for job in jobs}, {during})
        self.assertEqual(len(jobs), 2)
        self.assertEqual(await self.tick(during), 2)
        feed = (await self.request('GET', '/api/notifications'))[1]['items']
        self.assertEqual({row['resource_type'] for row in feed}, {'event', 'note'})

    async def test_custom_reminders_at_or_after_end_rejected_and_shortening_rolls_back(self):
        for at in (START+timedelta(hours=1), START+timedelta(days=1)):
            payload = self.event_payload(starts_at=START.isoformat(), ends_at=(START+timedelta(hours=1)).isoformat(), reminder_at=at.isoformat())
            self.assertEqual((await self.request('POST', '/api/calendar/events', payload=payload))[0], 422)
            self.assertEqual((await self.request('POST', '/api/notes', payload={'title':'Invalid note', 'calendar_schedule':{
                'starts_at':START.isoformat(), 'ends_at':(START+timedelta(hours=1)).isoformat(), 'is_all_day':False, 'reminder_at':at.isoformat()}}))[0], 422)
        event = await self.event(reminder_at=(START+timedelta(minutes=45)).isoformat())
        code, _ = await self.request('PUT', '/api/calendar/events/'+event['id'], payload=self.event_payload(
            starts_at=START.isoformat(), ends_at=(START+timedelta(minutes=30)).isoformat()))
        self.assertEqual(code, 422)
        saved = (await self.request('GET', '/api/calendar/events/'+event['id']))[1]
        self.assertEqual(saved['ends_at'], event['ends_at'])
        self.assertEqual(len(await self.jobs()), 1)

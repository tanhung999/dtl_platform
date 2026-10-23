from datetime import datetime, timedelta, timezone
from uuid import uuid4
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.calendar import CalendarEvent
from app.db.notifications import NotificationJob as Job, Notification
from app.modules.notifications.worker import deliver_batch
from app.modules.access.service import seed_catalog
from app.db.access import UserRole
from app.db.models import Task

class CalendarRecurrenceTests(ApiTestCase):
    async def test_large_mixed_pages_and_shared_privacy(self):
        start = datetime(2026, 11, 2, 17, tzinfo=timezone.utc)
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='calendar_sharer'))
            for i in range(510):
                db.add(CalendarEvent(id=f'grid-{i:04}', user_id='alice', title=f'Event {i}', starts_at=start, ends_at=start + timedelta(days=1), is_all_day=True))
                # Same IDs across tables and midnight/null clocks must remain distinct and ordered.
                db.add(Task(id=f'grid-{i:04}', user_id='alice', title=f'Task {i}', due_date=(start + timedelta(hours=7)).date(), due_time='00:00' if i % 2 else None))
            db.add(CalendarEvent(user_id='alice', title='Private', starts_at=start, ends_at=start + timedelta(days=1), is_all_day=True, is_private=True))
            await db.commit()
        query = {'start': start.isoformat(), 'end': (start + timedelta(days=1)).isoformat()}
        code, first = await self.request('GET', '/api/calendar/events/collection', query=query)
        self.assertEqual(code, 200, first); self.assertEqual(first['total'], 511)
        _, last = await self.request('GET', '/api/calendar/events/collection', query={**query, 'offset': 500})
        self.assertEqual(len(last['items']), 11); self.assertFalse(last['truncated'])
        task_query = {'start': '2026-11-03', 'end': '2026-11-04'}
        _, first_tasks = await self.request('GET', '/api/tasks/calendar/page', query=task_query)
        _, last_tasks = await self.request('GET', '/api/tasks/calendar/page', query={**task_query, 'offset': 500})
        self.assertEqual(first_tasks['total'], 510); self.assertEqual(len(last_tasks['items']), 10)
        self.assertFalse(last_tasks['truncated'])
        code, grant = await self.request('PUT', '/api/calendar-sharing/mine/bob', payload={'expected_version': 0, 'share_events': True, 'share_tasks': True, 'share_notes': False})
        self.assertEqual(code, 200, grant)
        shared = []
        for offset in (0, 500, 1000):
            code, page = await self.request('GET', '/api/calendar-sharing/view/alice', user='bob', query={**query, 'offset': offset})
            self.assertEqual(code, 200, page); self.assertEqual(page['total'], 1020)
            shared.extend(page['items'])
        self.assertEqual(len(shared), 1020)
        self.assertEqual(len({(item['kind'], item['id']) for item in shared}), 1020)
        self.assertFalse(page['truncated'])
        self.assertTrue(all(item['title'] != 'Private' for item in shared))
        self.assertEqual([(item['id'], item['kind']) for item in shared], sorted((item['id'], item['kind']) for item in shared))

    async def make(self, **changes):
        code, event = await self.request('POST', payload=self.event_payload(recurrence='DAILY', **changes))
        self.assertEqual(code, 201, event)
        return event

    async def test_daily_occurrences_future_range_counts_and_cap(self):
        event = await self.make()
        query = {'start':'2026-11-02T00:00:00+07:00','end':'2026-11-09T00:00:00+07:00'}
        code, page = await self.request('GET','/api/calendar/events/collection',query=query)
        self.assertEqual(code,200,page); self.assertEqual(page['total'],7)
        self.assertEqual(len({item['id'] for item in page['items']}),7)
        self.assertTrue(all(item['series_id']==event['id'] and item['starts_at'][11:16]=='02:00' and item['ends_at'][11:16]=='03:00' for item in page['items']))
        self.assertEqual(len((await self.request('GET',query=query))[1]),7)
        _, days = await self.request('GET','/api/calendar/days',query={'start':'2026-11-02','end':'2026-11-09'})
        self.assertTrue(all(day['events']==1 for day in days.values()))
        _, capped = await self.request('GET','/api/calendar/events/collection',query={**query,'limit':2})
        self.assertEqual(len(capped['items']),2); self.assertEqual(capped['total'],7); self.assertTrue(capped['truncated'])
        _, second = await self.request('GET','/api/calendar/events/collection',query={**query,'limit':2,'offset':2})
        self.assertEqual([item['id'] for item in second['items']], [item['id'] for item in page['items'][2:4]])
        _, final = await self.request('GET','/api/calendar/events/collection',query={**query,'limit':2,'offset':6})
        self.assertEqual(len(final['items']),1); self.assertFalse(final['truncated']); self.assertEqual(final['total'],7)
        self.assertEqual((await self.request('GET','/api/calendar/events/collection',query={**query,'offset':-1}))[0],422)
        self.assertEqual((await self.request('GET',user='bob',query=query))[1],[])
        _, before = await self.request('GET',query={'start':'2026-10-01T00:00:00+07:00','end':'2026-10-12T09:00:00+07:00'})
        self.assertEqual(before,[])

    async def test_weekly_notes_stop_and_existing_writes_preserve_rule(self):
        code, note = await self.request('POST','/api/notes',payload={'title':'Weekly note','calendar_schedule':{'starts_at':'2026-12-28T09:00:00+07:00','ends_at':'2026-12-28T10:00:00+07:00','recurrence':'WEEKLY'}})
        self.assertEqual(code,201,note); schedule=note['calendar_schedule']; self.assertEqual(schedule['recurrence'],'WEEKLY')
        query={'start':'2027-01-01T00:00:00+07:00','end':'2027-02-01T00:00:00+07:00'}
        _, page=await self.request('GET','/api/calendar/events/collection',query=query)
        self.assertEqual(page['note_total'],4); self.assertTrue(all(item['scheduled_note_id']==note['id'] for item in page['items']))
        code, note=await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'calendar_schedule':{**schedule,'recurrence':'NONE'}})
        self.assertEqual(code,200,note)
        self.assertEqual((await self.request('GET','/api/calendar/events/collection',query=query))[1]['total'],0)

    async def test_edit_stop_delete_and_invalid_rule(self):
        event=await self.make(); path='/api/calendar/events/'+event['id']
        code, current=await self.request('PUT',path,payload=self.event_payload(title='Keep recurrence'))
        self.assertEqual(code,200,current); self.assertEqual(current['recurrence'],'DAILY')
        code, _=await self.request('PUT',path,payload=self.event_payload(recurrence='WEEKLY',expected_updated_at=event['updated_at']))
        self.assertEqual(code,409)
        for recurrence in ('MONTHLY','daily'):
            self.assertEqual((await self.request('POST',payload=self.event_payload(recurrence=recurrence)))[0],422)
        self.assertEqual((await self.request('POST',payload=self.event_payload(recurrence='DAILY',ends_at='2026-10-14T10:00:00+07:00')))[0],422)
        self.assertEqual((await self.request('DELETE',path))[0],204)
        self.assertEqual((await self.request('GET',query=self.range_query(end='2026-10-19T00:00:00+07:00')))[1],[])

    async def test_relative_reminders_repeat_once_and_cancel_on_rule_edit(self):
        start=datetime(2099,1,5,2,tzinfo=timezone.utc)
        event=await self.make(starts_at=start.isoformat(),ends_at=(start+timedelta(hours=1)).isoformat(),reminder_minutes=15)
        for index in (0,1):
            tick=start+timedelta(days=index,minutes=-15)
            async with self.sessions() as db:
                self.assertEqual(await deliver_batch(db,tick),1); await db.commit()
            async with self.sessions() as db:
                self.assertEqual(await deliver_batch(db,tick),0)
                self.assertEqual(await db.scalar(select(func.count()).select_from(Notification)),index+1)
                jobs=(await db.scalars(select(Job).where(Job.processed_at.is_(None)))).all()
                self.assertEqual(len(jobs),1); self.assertEqual(jobs[0].scheduled_at,start+timedelta(days=index+1,minutes=-15))
        path='/api/calendar/events/'+event['id']
        self.assertEqual((await self.request('PUT',path,payload=self.event_payload(starts_at=start.isoformat(),ends_at=(start+timedelta(hours=1)).isoformat(),recurrence='NONE',reminder_minutes=None,reminder_at=None)))[0],200)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(Job).where(Job.processed_at.is_(None))),0)

    async def test_move_undo_preserves_recurrence_and_noop_is_rejected(self):
        event=await self.make(); path='/api/schedule-changes/event/'+event['id']
        payload={'request_id':str(uuid4()),'expected_updated_at':event['updated_at'],'starts_at':event['starts_at'],'ends_at':event['ends_at'],'is_all_day':False}
        self.assertEqual((await self.request('POST',path,payload=payload))[0],422)
        payload.update(request_id=str(uuid4()),starts_at='2026-10-13T09:00:00+07:00',ends_at='2026-10-13T10:00:00+07:00')
        code, change=await self.request('POST',path,payload=payload); self.assertEqual(code,200,change)
        self.assertEqual(change['after']['recurrence'],'DAILY')
        code, undone=await self.request('POST','/api/schedule-changes/records/'+change['id']+'/undo')
        self.assertEqual(code,200,undone)
        self.assertEqual((await self.request('GET','/api/calendar/events/'+event['id']))[1]['recurrence'],'DAILY')

    async def test_shared_occurrences_scopes_and_revoke(self):
        async with self.sessions() as db:
            await seed_catalog(db); db.add(UserRole(user_id='alice',role_id='calendar_sharer')); await db.commit()
        event=await self.make()
        code, share=await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0,'share_events':True,'share_notes':False,'share_tasks':False})
        self.assertEqual(code,200,share)
        query=self.range_query(start='2026-11-02T00:00:00+07:00',end='2026-11-09T00:00:00+07:00')
        code, page=await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=query)
        self.assertEqual(code,200,page); self.assertEqual(page['total'],7); self.assertEqual(len(page['items']),7)
        self.assertTrue(all(item['series_id']==event['id'] for item in page['items']))
        self.assertEqual((await self.request('GET','/api/calendar-sharing/view/alice/event/'+event['id'],user='bob'))[0],200)
        await self.request('DELETE','/api/calendar-sharing/mine/bob',query={'expected_version':share['version'],'expected_id':share['id']})
        self.assertEqual((await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=query))[0],404)

    async def test_multi_day_all_day_weekly_notes_and_event_day_counts(self):
        code,event=await self.request('POST',payload=self.event_payload(starts_at='2026-10-16T00:00:00+07:00',ends_at='2026-10-19T00:00:00+07:00',is_all_day=True))
        self.assertEqual(code,201,event)
        code, updated=await self.request('PUT','/api/calendar/events/'+event['id'],payload=self.event_payload(starts_at=event['starts_at'],ends_at=event['ends_at'],is_all_day=True,recurrence='WEEKLY'))
        self.assertEqual(code,200,updated)
        query={'start':'2026-10-23T00:00:00+07:00','end':'2026-10-26T00:00:00+07:00'}
        code, page=await self.request('GET','/api/calendar/events/collection',query=query)
        self.assertEqual(code,200,page); self.assertEqual(page['total'],1)
        self.assertEqual(datetime.fromisoformat(page['items'][0]['ends_at'].replace('Z','+00:00')),datetime(2026,10,25,17,tzinfo=timezone.utc))
        _, days=await self.request('GET','/api/calendar/days',query={'start':'2026-10-23','end':'2026-10-26'})
        self.assertTrue(all(value['events']==1 for value in days.values()))
        code,note=await self.request('POST','/api/notes',payload={'title':'All-day weekly range','calendar_schedule':{'starts_at':event['starts_at'],'ends_at':event['ends_at'],'is_all_day':True,'recurrence':'WEEKLY'}})
        self.assertEqual(code,201,note)
        self.assertEqual(note['calendar_schedule']['ends_at'],event['ends_at'])

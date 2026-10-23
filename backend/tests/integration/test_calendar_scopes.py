from uuid import uuid4
from datetime import datetime, timezone
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException
from app.db.notifications import NotificationJob

class CalendarScopeTests(ApiTestCase):
    start='2099-01-05T09:00:00+07:00'
    end='2099-01-05T10:00:00+07:00'
    at='2099-01-07T09:00:00+07:00'

    async def make(self, note=False, recurrence='DAILY'):
        payload=dict(starts_at=self.start, ends_at=self.end, recurrence=recurrence, reminder_minutes=15)
        if note:
            code,row=await self.request('POST','/api/notes',payload={'title':'Scoped note','content':'Preserve content','calendar_schedule':payload})
            self.assertEqual(code,201,row)
            return row,row['calendar_schedule']['event_id']
        code,row=await self.request('POST',payload=self.event_payload(**payload))
        self.assertEqual(code,201,row)
        return row,row['id']

    async def page(self):
        code,page=await self.request('GET','/api/calendar/events/collection',query={'start':'2099-01-05T00:00:00+07:00','end':'2099-01-10T00:00:00+07:00'})
        self.assertEqual(code,200,page)
        return page

    async def test_delete_scopes_preserve_past_and_cancel_future_reminders(self):
        for scope,total in [('THIS',4),('FOLLOWING',2),('ALL',0)]:
            with self.subTest(scope=scope):
                row,event_id=await self.make()
                code,_=await self.request('DELETE','/api/calendar/events/'+event_id,query={'expected_updated_at':row['updated_at'],'scope':scope,'occurrence_at':self.at})
                self.assertEqual(code,204)
                page=await self.page()
                self.assertEqual(page['total'],total)
                if scope=='FOLLOWING':
                    _,preview=await self.request('GET','/api/calendar/events/'+event_id+'/next-reminder',query={'minutes':15})
                    self.assertIsNotNone(preview['at'])
                # Clean the retained source before the next case.
                if scope!='ALL': self.assertEqual((await self.request('DELETE','/api/calendar/events/'+event_id))[0],204)

    async def test_note_partial_deletion_keeps_content(self):
        row,event_id=await self.make(note=True)
        code,_=await self.request('DELETE','/api/notes/'+row['id'],payload={'expected_version':row['version'],'scope':'THIS','occurrence_at':self.at})
        self.assertEqual(code,204)
        _,saved=await self.request('GET','/api/notes/'+row['id'])
        self.assertEqual(saved['content'],'Preserve content')
        self.assertEqual((await self.page())['total'],4)
        self.assertEqual((await self.request('DELETE','/api/notes/'+row['id']))[0],204)
        self.assertEqual((await self.page())['total'],0)

    async def test_move_scopes_events_and_notes_with_replay_and_undo(self):
        for note in (False,True):
            for scope in ('THIS','FOLLOWING'):
                with self.subTest(note=note,scope=scope):
                    row,event_id=await self.make(note)
                    kind='note' if note else 'event'
                    guard={'expected_updated_at':row['calendar_schedule']['expected_updated_at'],'expected_version':row['version']} if note else {'expected_updated_at':row['updated_at']}
                    payload={**guard,'request_id':str(uuid4()),'scope':scope,'occurrence_at':self.at,
                        'starts_at':'2099-01-07T11:00:00+07:00','ends_at':'2099-01-07T12:00:00+07:00',
                        'recurrence':'DAILY','reminder_minutes':15}
                    path='/api/schedule-changes/'+kind+'/'+row['id']
                    code,change=await self.request('POST',path,payload=payload)
                    self.assertEqual(code,200,change)
                    editor = change['editor']
                    self.assertEqual(editor['kind'], kind)
                    target_id = change['guard']['scoped']['child_note_id'] if note else change['guard']['scoped']['child_id']
                    self.assertEqual(editor['resource']['id'], target_id)
                    self.assertNotEqual(target_id, row['id'])
                    actual = editor['resource']['calendar_schedule'] if note else editor['resource']
                    self.assertEqual(datetime.fromisoformat(actual['starts_at'].replace('Z', '+00:00')).hour, 4)
                    self.assertEqual(actual['recurrence'], 'NONE' if scope == 'THIS' else 'DAILY')
                    replay = (await self.request('POST',path,payload=payload))[1]
                    self.assertEqual(replay['id'], change['id'])
                    self.assertEqual(replay['editor'], editor)
                    page=await self.page()
                    self.assertEqual(page['total'],5)
                    hours=[datetime.fromisoformat(item['starts_at'].replace('Z','+00:00')).hour for item in page['items']]
                    self.assertEqual(hours[:2],[2,2])
                    self.assertEqual(hours[2:],[4,2,2] if scope=='THIS' else [4,4,4])
                    if note:
                        _,notes=await self.request('GET','/api/notes')
                        self.assertTrue(all(item['content']=='Preserve content' for item in notes))
                    code,undone=await self.request('POST','/api/schedule-changes/records/'+change['id']+'/undo')
                    self.assertEqual(code,200,undone)
                    self.assertEqual(undone['editor']['resource']['id'], row['id'])
                    self.assertEqual(datetime.fromisoformat(undone['editor']['occurrence_at']).hour, 2)
                    self.assertEqual((await self.page())['total'],5)
                    self.assertEqual((await self.request('DELETE', '/api/notes/'+row['id'] if note else '/api/calendar/events/'+event_id))[0],204)

    async def test_invalid_weekday_and_other_owner_cannot_mutate(self):
        row,event_id=await self.make(recurrence='WEEKLY')
        query={'expected_updated_at':row['updated_at'],'scope':'THIS','occurrence_at':self.at}
        self.assertEqual((await self.request('DELETE','/api/calendar/events/'+event_id,query=query,user='bob'))[0],404)
        self.assertEqual((await self.request('DELETE','/api/calendar/events/'+event_id,query=query))[0],409)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarException)),0)

    async def test_all_move_updates_prior_edits_and_segments_and_undo_restores_them(self):
        row,event_id=await self.make()
        for scope,at,hour in [('THIS',self.at,11),('FOLLOWING','2099-01-08T09:00:00+07:00',12)]:
            _,current=await self.request('GET','/api/calendar/events/'+event_id)
            day=at[:10]
            code,change=await self.request('POST','/api/schedule-changes/event/'+event_id,payload={
                'request_id':str(uuid4()),'scope':scope,'occurrence_at':at,'expected_updated_at':current['updated_at'],
                'starts_at':day+f'T{hour}:00:00+07:00','ends_at':day+f'T{hour+1}:00:00+07:00','recurrence':'DAILY'})
            self.assertEqual(code,200,change)
        before=(await self.page())['items']
        _,current=await self.request('GET','/api/calendar/events/'+event_id)
        code,change=await self.request('POST','/api/schedule-changes/event/'+event_id,payload={
            'request_id':str(uuid4()),'scope':'ALL','expected_updated_at':current['updated_at'],
            'starts_at':'2099-01-05T13:00:00+07:00','ends_at':'2099-01-05T14:00:00+07:00','recurrence':'DAILY'})
        self.assertEqual(code,200,change)
        after=(await self.page())['items']
        self.assertEqual(len(after),5)
        self.assertEqual([datetime.fromisoformat(item['starts_at'].replace('Z','+00:00')).hour for item in after],[6]*5)
        code,undone=await self.request('POST','/api/schedule-changes/records/'+change['id']+'/undo')
        self.assertEqual(code,200,undone)
        restored=(await self.page())['items']
        self.assertEqual([(x['id'],x['starts_at']) for x in restored],[(x['id'],x['starts_at']) for x in before])

    async def test_following_delete_stops_worker_at_boundary_and_weekly_selection(self):
        from app.modules.notifications.worker import deliver_batch
        row,event_id=await self.make()
        self.assertEqual((await self.request('DELETE','/api/calendar/events/'+event_id,query={
            'expected_updated_at':row['updated_at'],'scope':'FOLLOWING','occurrence_at':self.at}))[0],204)
        async with self.sessions() as db:
            self.assertEqual(await deliver_batch(db,datetime(2099,1,5,1,45,tzinfo=timezone.utc)),1)
            await db.commit()
            self.assertEqual(await deliver_batch(db,datetime(2099,1,6,1,45,tzinfo=timezone.utc)),1)
            await db.commit()
            self.assertEqual(await deliver_batch(db,datetime(2099,1,7,1,45,tzinfo=timezone.utc)),0)
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob).where(NotificationJob.processed_at.is_(None))),0)
        await self.request('DELETE','/api/calendar/events/'+event_id)
        row,event_id=await self.make(note=True,recurrence='WEEKLY')
        code,change=await self.request('POST','/api/schedule-changes/note/'+row['id'],payload={
            'request_id':str(uuid4()),'scope':'FOLLOWING','occurrence_at':'2099-01-12T09:00:00+07:00',
            'expected_version':row['version'],'expected_updated_at':row['calendar_schedule']['expected_updated_at'],
            'starts_at':'2099-01-12T11:00:00+07:00','ends_at':'2099-01-12T12:00:00+07:00','recurrence':'WEEKLY'})
        self.assertEqual(code,200,change)
        _,page=await self.request('GET','/api/calendar/events/collection',query={'start':'2099-01-05T00:00:00+07:00','end':'2099-01-27T00:00:00+07:00'})
        self.assertEqual(len(page['items']),4)
        self.assertEqual([datetime.fromisoformat(x['starts_at'].replace('Z','+00:00')).hour for x in page['items']],[2,4,4,4])

    async def test_edited_occurrence_still_offers_and_supports_all_three_scopes(self):
        for note in (False,True):
            for scope in ('THIS','FOLLOWING','ALL'):
                with self.subTest(note=note,scope=scope):
                    row,event_id=await self.make(note)
                    kind='note' if note else 'event'
                    guard={'expected_updated_at':row['calendar_schedule']['expected_updated_at'],'expected_version':row['version']} if note else {'expected_updated_at':row['updated_at']}
                    _,change=await self.request('POST','/api/schedule-changes/'+kind+'/'+row['id'],payload={
                        **guard,'request_id':str(uuid4()),'scope':'THIS','occurrence_at':self.at,
                        'starts_at':'2099-01-07T11:00:00+07:00','ends_at':'2099-01-07T12:00:00+07:00','recurrence':'DAILY'})
                    child_id=change['guard']['scoped']['child_id']
                    _,child=await self.request('GET','/api/calendar/events/'+child_id)
                    self.assertEqual(child['series_recurrence'],'DAILY')
                    resource=change['guard']['scoped']['child_note_id'] if note else child_id
                    if note:
                        _,child_note=await self.request('GET','/api/notes/'+resource)
                        self.assertEqual(child_note['calendar_series_recurrence'],'DAILY')
                        guard={'expected_version':child_note['version'],'expected_updated_at':child_note['calendar_schedule']['expected_updated_at']}
                    else: guard={'expected_updated_at':child['updated_at']}
                    code,moved=await self.request('POST','/api/schedule-changes/'+kind+'/'+resource,payload={
                        **guard,'request_id':str(uuid4()),'scope':scope,'occurrence_at':child['starts_at'],
                        'starts_at':'2099-01-07T13:00:00+07:00','ends_at':'2099-01-07T14:00:00+07:00','recurrence':'DAILY'})
                    self.assertEqual(code,200,moved)
                    hours=[datetime.fromisoformat(x['starts_at'].replace('Z','+00:00')).hour for x in (await self.page())['items']]
                    self.assertEqual(hours,[2,2,6,2,2] if scope=='THIS' else [2,2,6,6,6] if scope=='FOLLOWING' else [6]*5)
                    code,undone=await self.request('POST','/api/schedule-changes/records/'+moved['id']+'/undo')
                    self.assertEqual(code,200,undone)
                    _,child=await self.request('GET','/api/calendar/events/'+child_id)
                    code,_=await self.request('DELETE','/api/calendar/events/'+child_id,query={
                        'scope':'FOLLOWING' if scope=='FOLLOWING' else 'THIS','occurrence_at':child['starts_at'],'expected_updated_at':child['updated_at']})
                    self.assertEqual(code,204)
                    self.assertEqual((await self.page())['total'],2 if scope=='FOLLOWING' else 4)
                    self.assertEqual((await self.request('GET','/api/calendar/events/'+event_id))[0],200)
                    await self.request('DELETE','/api/notes/'+row['id'] if note else '/api/calendar/events/'+event_id)

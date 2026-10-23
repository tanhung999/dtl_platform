from uuid import uuid4
from tests.support.api_case import ApiTestCase

class NotificationSettingsTests(ApiTestCase):
    async def test_notification_only_for_scheduled_resources_and_undo(self):
        for kind in ('task','event','note'):
            with self.subTest(kind=kind):
                if kind=='task':
                    _,row=await self.request('POST','/api/tasks',payload={'title':'Settings','due_date':'2099-01-05','due_time':'09:00'})
                    target={'expected_version':row['version']}
                else:
                    schedule={'starts_at':'2099-01-05T09:00:00+07:00','ends_at':'2099-01-05T10:00:00+07:00','recurrence':'NONE'}
                    if kind=='event':
                        _,row=await self.request('POST',payload=self.event_payload(**schedule))
                        target={**schedule,'expected_updated_at':row['updated_at']}
                    else:
                        _,row=await self.request('POST','/api/notes',payload={'title':'Settings','content':'Preserve','calendar_schedule':schedule})
                        target={**schedule,'expected_version':row['version'],'expected_updated_at':row['calendar_schedule']['expected_updated_at']}
                body={**target,'request_id':str(uuid4()),'reminder_minutes':15,'reminder_at':None}
                path='/api/schedule-changes/'+kind+'/'+row['id']
                code,change=await self.request('POST',path,payload=body)
                self.assertEqual(code,200,change)
                self.assertEqual(change['before']['starts_at'] if kind!='task' else change['before']['due_date'],change['after']['starts_at'] if kind!='task' else change['after']['due_date'])
                self.assertEqual(change['after']['reminder_minutes'],15)
                self.assertEqual((await self.request('POST',path,payload=body))[1]['id'],change['id'])
                code,result=await self.request('POST','/api/schedule-changes/records/'+change['id']+'/undo')
                self.assertEqual(code,200,result)
                self.assertIsNone(result['current']['reminder_minutes'])

    async def test_unscheduled_task_and_note_notifications_do_not_create_dates(self):
        for kind in ('task','note'):
            _,row=await self.request('POST','/api/'+('tasks' if kind=='task' else 'notes'),payload={'title':'No dates'})
            body={'request_id':str(uuid4()),'expected_version':row['version'],'reminder_at':'2099-01-04T08:00:00+07:00','reminder_minutes':None}
            if kind=='task': body.update(due_date=None,due_time=None)
            code,change=await self.request('POST','/api/schedule-changes/'+kind+'/'+row['id'],payload=body)
            self.assertEqual(code,200,change)
            _,saved=await self.request('GET','/api/'+('tasks' if kind=='task' else 'notes')+'/'+row['id'])
            self.assertIsNone(saved.get('due_date') if kind=='task' else saved['calendar_schedule'])
            self.assertIsNotNone(saved['reminder_at'])
            code,result=await self.request('POST','/api/schedule-changes/records/'+change['id']+'/undo')
            self.assertEqual(code,200,result)
            self.assertIsNone(result['current']['reminder_at'])

    async def test_all_notification_change_keeps_edited_occurrence_time(self):
        _,event=await self.request('POST',payload=self.event_payload(starts_at='2099-01-05T09:00:00+07:00',ends_at='2099-01-05T10:00:00+07:00',recurrence='DAILY'))
        _,once=await self.request('POST','/api/schedule-changes/event/'+event['id'],payload={'request_id':str(uuid4()),'expected_updated_at':event['updated_at'],'scope':'THIS','occurrence_at':'2099-01-06T09:00:00+07:00','starts_at':'2099-01-06T11:00:00+07:00','ends_at':'2099-01-06T12:00:00+07:00','recurrence':'NONE'})
        child_id=once['guard']['scoped']['child_id']
        _,child=await self.request('GET','/api/calendar/events/'+child_id)
        code,changed=await self.request('POST','/api/schedule-changes/event/'+child_id,payload={'request_id':str(uuid4()),'expected_updated_at':child['updated_at'],'scope':'ALL','starts_at':child['starts_at'],'ends_at':child['ends_at'],'recurrence':'DAILY','reminder_minutes':15})
        self.assertEqual(code,200,changed)
        _,after=await self.request('GET','/api/calendar/events/'+child_id)
        self.assertEqual(after['starts_at'],child['starts_at'])
        _,source=await self.request('GET','/api/calendar/events/'+event['id'])
        self.assertEqual(source['starts_at'],event['starts_at'])
        self.assertEqual(after['reminder_minutes'],15)
        self.assertEqual(source['reminder_minutes'],15)

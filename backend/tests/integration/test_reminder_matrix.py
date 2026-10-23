"""Reminder boundary and lifecycle checks, including items without deadlines."""
from datetime import timedelta
from unittest.mock import patch
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from tests.integration import test_user_reminders as reminders
from app.db.notifications import NotificationJob as Job, Notification

NOW = reminders.NOW


class ReminderMatrixTests(ApiTestCase):
    tick = reminders.UserReminderTests.tick

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.notifications.scheduling.utcnow','app.modules.tasks.router.utcnow'):
            clock=patch(name,return_value=NOW); clock.start(); self.addCleanup(clock.stop)

    async def test_inactive_items_cannot_store_new_past_reminders(self):
        for kind in ('task','note'):
            with self.subTest(kind=kind):
                base='/api/tasks' if kind=='task' else '/api/notes'
                code,row=await self.request('POST',base,payload={'title':'Inactive '+kind})
                self.assertEqual(code,201,row)
                inactive={'is_completed':True} if kind=='task' else {'is_archived':True}
                code,row=await self.request('PATCH',base+'/'+row['id'],payload={'expected_version':row['version'],**inactive})
                self.assertEqual(code,200,row)
                code,bad=await self.request('PATCH',base+'/'+row['id'],payload={'expected_version':row['version'],'reminder_at':NOW.isoformat()})
                self.assertEqual(code,422,bad)
                current=(await self.request('GET',base+'/'+row['id']))[1]
                self.assertIsNone(current['reminder_at']); self.assertEqual(current['version'],row['version'])

    async def test_creation_matrix_time_bounds_and_delivery_once(self):
        # Each tuple is independent of the implementation's scheduling helpers.
        day=NOW.date().isoformat()
        tasks=[('undated',{},None,None,False),
            ('past',{'due_date':'2000-01-01','due_time':'09:00'},NOW-timedelta(days=100),NOW-timedelta(days=100),False),
            ('now',{'due_date':day,'due_time':'07:00'},NOW,NOW,False),
            ('future',{'due_date':day,'due_time':'09:00'},NOW+timedelta(hours=2),NOW+timedelta(hours=2),False),
            ('past-all-day',{'due_date':'2000-01-01'},NOW-timedelta(days=101),NOW-timedelta(days=100),True),
            ('today-all-day',{'due_date':day},NOW-timedelta(hours=7),NOW+timedelta(hours=17),True)]
        appointments=[('past',NOW-timedelta(days=2),NOW-timedelta(days=1),False),
            ('ongoing',NOW-timedelta(hours=1),NOW+timedelta(hours=1),False),
            ('future',NOW+timedelta(hours=2),NOW+timedelta(hours=3),False),
            ('past-all-day',NOW-timedelta(hours=31),NOW-timedelta(hours=7),True),
            ('today-all-day',NOW-timedelta(hours=7),NOW+timedelta(hours=17),True)]
        rows=[('task',*row) for row in tasks]
        for kind in ('event','note'):
            for name,start,end,all_day in appointments:
                rows.append((kind,name,{'starts_at':start.isoformat(),'ends_at':end.isoformat(),'is_all_day':all_day},start,end,all_day))
        rows.append(('note','unscheduled',{},None,None,False))
        expected_jobs=0; checked=0
        for kind,name,fields,anchor,end,all_day in rows:
            cases=[('none',{},True)]
            for label,stamp in [('past',NOW-timedelta(minutes=1)),('now',NOW),('soon',NOW+timedelta(minutes=15)),('far',NOW+timedelta(days=2))]:
                allowed=stamp>NOW and (end is None or end<=NOW or stamp<end or kind=='task' and not all_day and stamp==end)
                cases.append((label,{'reminder_at':stamp.isoformat()},allowed))
            for minutes in (0,30):
                allowed=anchor is not None and not all_day and anchor-timedelta(minutes=minutes)>NOW
                cases.append(('offset-'+str(minutes),{'reminder_minutes':minutes},allowed))
            if end is not None:
                cases.append(('exact-end',{'reminder_at':end.isoformat()},end>NOW and kind=='task' and not all_day))
            for label,config,allowed in cases:
                with self.subTest(kind=kind,state=name,reminder=label):
                    title=f'{kind} {name} {label}'
                    if kind=='task': endpoint='/api/tasks'; payload={'title':title,**fields,**config}
                    elif kind=='event': endpoint='/api/calendar/events'; payload={'title':title,**fields,**config}
                    else:
                        endpoint='/api/notes'
                        payload={'title':title,'calendar_schedule':{**fields,**config}} if fields else {'title':title,**config}
                    code,data=await self.request('POST',endpoint,payload=payload)
                    self.assertEqual(code,201 if allowed else 422,data)
                    expected_jobs+=int(allowed and bool(config)); checked+=1
        self.assertEqual(checked,134)
        async with self.sessions() as db:
            jobs=(await db.scalars(select(Job).where(Job.processed_at.is_(None)))).all()
            self.assertEqual(len(jobs),expected_jobs)
        self.assertEqual(await self.tick(NOW+timedelta(days=3)),expected_jobs)
        self.assertEqual(await self.tick(NOW+timedelta(days=3)),0)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(Notification)),expected_jobs)

    async def test_archive_with_new_past_selection_rejected_but_old_reminder_can_be_archived(self):
        code,note=await self.request('POST','/api/notes',payload={'title':'Archive atomic','reminder_at':(NOW+timedelta(hours=1)).isoformat()})
        self.assertEqual(code,201,note); path='/api/notes/'+note['id']
        code,bad=await self.request('PATCH',path,payload={'expected_version':note['version'],'is_archived':True,'reminder_at':NOW.isoformat()})
        self.assertEqual(code,422,bad)
        current=(await self.request('GET',path))[1]; self.assertFalse(current['is_archived']); self.assertEqual(current['version'],note['version'])
        with patch('app.modules.notifications.scheduling.utcnow',return_value=NOW+timedelta(hours=2)):
            code,archived=await self.request('PATCH',path,payload={'expected_version':current['version'],'is_archived':True})
            self.assertEqual(code,200,archived)
            code,restored=await self.request('PATCH',path,payload={'expected_version':archived['version'],'is_archived':False})
            self.assertEqual(code,200,restored)
        self.assertEqual(await self.tick(NOW+timedelta(hours=3)),0)

    async def test_undated_task_and_note_selection_switch_clear_noop_and_conflict(self):
        for kind in ('task','note'):
            with self.subTest(kind=kind):
                endpoint='/api/tasks' if kind=='task' else '/api/notes'
                code,row=await self.request('POST',endpoint,payload={'title':'Switch '+kind,'reminder_at':(NOW+timedelta(hours=1)).isoformat()})
                self.assertEqual(code,201,row); path=endpoint+'/'+row['id']
                original_version=row['version']
                code,bad=await self.request('PATCH',path,payload={'expected_version':original_version,'reminder_minutes':30})
                self.assertEqual(code,422,bad)
                code,row=await self.request('PATCH',path,payload={'expected_version':original_version,'reminder_at':(NOW+timedelta(hours=2)).isoformat()})
                self.assertEqual(code,200,row)
                code,bad=await self.request('PATCH',path,payload={'expected_version':original_version,'reminder_at':None},guard=False)
                self.assertEqual(code,409,bad)
                code,same=await self.request('PATCH',path,payload={'expected_version':row['version'],'reminder_at':row['reminder_at']})
                self.assertEqual(code,200,same); self.assertEqual(same['version'],row['version'])
                self.assertEqual(await self.tick(NOW+timedelta(hours=1)),0)
                code,cleared=await self.request('PATCH',path,payload={'expected_version':row['version'],'reminder_at':None})
                self.assertEqual(code,200,cleared)
                self.assertEqual(await self.tick(NOW+timedelta(hours=3)),0)

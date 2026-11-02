"""Opt-in cadence, calendar clock alignment and scoped reminder isolation."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine
from tests.support.api_case import ApiTestCase
from app.db.notifications import Notification
from app.modules.notifications.worker import deliver_batch

START = datetime(2026, 11, 2, 2, tzinfo=timezone.utc)  # Monday 09:00 Vietnam
NOW = START - timedelta(hours=1)


class RepeatReminderOptInTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        for module in ('app.modules.notifications.scheduling', 'app.modules.calendar.reminders'):
            clock = patch(module + '.utcnow', return_value=NOW); clock.start(); self.addCleanup(clock.stop)

    async def make(self, kind='event', **extra):
        schedule = {'starts_at': START.isoformat(), 'ends_at': (START+timedelta(hours=1)).isoformat(),
                    'is_all_day': False, 'recurrence': 'DAILY', **extra}
        if kind == 'event':
            code, item = await self.request('POST', payload={'title': 'Repeat event', **schedule})
            self.assertEqual(code, 201, item)
            return item, item['id']
        code, item = await self.request('POST', '/api/notes', payload={'title': 'Repeat note', 'calendar_schedule': schedule})
        self.assertEqual(code, 201, item)
        return item, item['calendar_schedule']['event_id']

    async def tick(self, at):
        async with self.sessions() as db:
            await deliver_batch(db, now=at); await db.commit()

    async def notices(self, title):
        async with self.sessions() as db:
            return (await db.scalars(select(Notification).where(Notification.title.endswith(title)).order_by(Notification.occurred_at))).all()

    async def test_default_off_relative_and_absolute_only_send_once(self):
        for config in ({'reminder_minutes': 30}, {'reminder_at': (START-timedelta(minutes=30)).isoformat()}):
            item, _ = await self.make(**config)
            self.assertFalse(item['reminder_repeat'])
        await self.tick(START-timedelta(minutes=30))
        self.assertEqual(len(await self.notices('Repeat event')), 2)
        await self.tick(START+timedelta(days=8))
        self.assertEqual(len(await self.notices('Repeat event')), 2)

    async def test_daily_and_weekly_custom_clock_follow_event_days(self):
        for kind in ('event', 'note'):
            for recurrence, days in (('DAILY', 1), ('WEEKLY', 7)):
                with self.subTest(kind=kind, recurrence=recurrence):
                    item, event_id = await self.make(kind, recurrence=recurrence, reminder_repeat=True,
                        reminder_at=(START+timedelta(days=1, minutes=-30)).isoformat())
                    # The date in a custom value cannot shift a Monday series to Tuesday.
                    stamp = START-timedelta(minutes=30)
                    await self.tick(stamp); await self.tick(stamp+timedelta(days=days))
                    async with self.sessions() as db:
                        notices = (await db.scalars(select(Notification).where(Notification.event_id==event_id))).all()
                    self.assertEqual(len(notices), 2)
                    self.assertEqual({n.occurred_at.replace(tzinfo=timezone.utc) for n in notices}, {stamp, stamp+timedelta(days=days)})
                    self.assertEqual({n.due_at.replace(tzinfo=timezone.utc) for n in notices}, {START, START+timedelta(days=days)})
                    await self.tick(stamp+timedelta(days=days))
                    async with self.sessions() as db:
                        self.assertEqual(len((await db.scalars(select(Notification).where(Notification.event_id==event_id))).all()),2)

    async def test_relative_repeat_and_clear_stop_future_jobs(self):
        item, event_id = await self.make(reminder_minutes=15, reminder_repeat=True)
        await self.tick(START-timedelta(minutes=15)); await self.tick(START+timedelta(days=1,minutes=-15))
        self.assertEqual(len(await self.notices('Repeat event')),2)
        code, _ = await self.request('PUT','/api/calendar/events/'+event_id,payload={
            'title':item['title'],'starts_at':START.isoformat(),'ends_at':(START+timedelta(hours=1)).isoformat(),
            'recurrence':'DAILY','reminder_minutes':None,'reminder_at':None,'reminder_repeat':False})
        self.assertEqual(code,200)
        await self.tick(START+timedelta(days=2)); self.assertEqual(len(await self.notices('Repeat event')),2)

    async def test_scopes_event_and_note_keep_other_occurrences_unchanged(self):
        for kind in ('event','note'):
            for scope in ('ALL','FOLLOWING','THIS'):
                with self.subTest(kind=kind,scope=scope):
                    item, event_id = await self.make(kind,reminder_repeat=True,reminder_at=(START-timedelta(minutes=30)).isoformat())
                    current = item if kind=='event' else item['calendar_schedule']
                    boundary = START+timedelta(days=1)
                    start = START if scope=='ALL' else boundary
                    body={'scope':scope,'occurrence_at':boundary.isoformat(),'request_id':str(uuid4()),
                          'starts_at':start.isoformat(),'ends_at':(start+timedelta(hours=1)).isoformat(),
                          'recurrence':'DAILY','reminder_repeat':True,'reminder_at':(START-timedelta(minutes=45)).isoformat(),
                          'expected_updated_at': current.get('updated_at',current.get('expected_updated_at'))}
                    if kind=='note':body['expected_version']=item['version']
                    code, change=await self.request('POST',f'/api/schedule-changes/{kind}/{item["id"]}',payload=body)
                    self.assertEqual(code,200,change)
                    for day in range(3):
                        await self.tick(START+timedelta(days=day,minutes=-45))
                        await self.tick(START+timedelta(days=day,minutes=-30))
                    child_id=change['guard'].get('scoped',{}).get('child_id')
                    async with self.sessions() as db:
                        notices=(await db.scalars(select(Notification).where(Notification.event_id.in_([event_id,child_id] if child_id else [event_id])))).all()
                    expected=[START+timedelta(minutes=-45 if scope=='ALL' else -30),
                              boundary-timedelta(minutes=45),
                              START+timedelta(days=2,minutes=-30 if scope=='THIS' else -45)]
                    self.assertEqual(sorted(n.occurred_at.replace(tzinfo=timezone.utc) for n in notices),expected)

    async def test_migration_retains_legacy_relative_repeats_only(self):
        from app.db.migrations.repeating_reminders import migrate_repeating_reminders
        engine=create_async_engine('sqlite+aiosqlite:///:memory:')
        try:
            async with engine.begin() as conn:
                await conn.execute(text('CREATE TABLE calendar_events(id TEXT, recurrence TEXT, reminder_minutes INTEGER)'))
                await conn.execute(text("INSERT INTO calendar_events VALUES ('relative','DAILY',15),('absolute','WEEKLY',NULL),('single','NONE',15)"))
                await migrate_repeating_reminders(conn)
                self.assertEqual(dict((await conn.execute(text('SELECT id,reminder_repeat FROM calendar_events'))).all()),{'relative':1,'absolute':0,'single':0})
                await conn.execute(text("INSERT INTO calendar_events(id,recurrence,reminder_minutes) VALUES ('new','DAILY',15)"))
                await migrate_repeating_reminders(conn)
                self.assertEqual(await conn.scalar(text("SELECT reminder_repeat FROM calendar_events WHERE id='new'")),0)
        finally:await engine.dispose()

    async def test_repeat_only_change_and_undo_restore_original_choice(self):
        for kind in ('event', 'note'):
            for scope in ('ALL', 'FOLLOWING', 'THIS'):
                with self.subTest(kind=kind, scope=scope):
                    item, event_id = await self.make(kind, reminder_minutes=30)
                    current = item if kind == 'event' else item['calendar_schedule']
                    boundary = START + timedelta(days=1)
                    start = START if scope == 'ALL' else boundary
                    body = {'request_id':str(uuid4()), 'scope':scope, 'occurrence_at':boundary.isoformat(),
                            'starts_at':start.isoformat(), 'ends_at':(start+timedelta(hours=1)).isoformat(),
                            'recurrence':'DAILY', 'reminder_minutes':15 if scope == 'THIS' else 30, 'reminder_repeat':True,
                            'expected_updated_at':current.get('updated_at', current.get('expected_updated_at'))}
                    if kind == 'note': body['expected_version'] = item['version']
                    code, change = await self.request('POST', f'/api/schedule-changes/{kind}/{item["id"]}', payload=body)
                    self.assertEqual(code, 200, change)
                    resource = change['editor']['resource']
                    schedule = resource if kind == 'event' else resource['calendar_schedule']
                    self.assertEqual(schedule['reminder_repeat'], scope != 'THIS')
                    self.assertEqual(change['after']['reminder_repeat'], schedule['reminder_repeat'])
                    self.assertEqual(change['after']['recurrence'], schedule['recurrence'])
                    self.assertEqual(datetime.fromisoformat(change['after']['starts_at'].replace('Z', '+00:00')), datetime.fromisoformat(schedule['starts_at'].replace('Z', '+00:00')))
                    code, undo = await self.request('POST', '/api/schedule-changes/records/'+change['id']+'/undo')
                    self.assertEqual(code, 200, undo)
                    _, restored = await self.request('GET', '/api/calendar/events/'+event_id)
                    self.assertFalse(restored['reminder_repeat'])
                    self.assertEqual(restored['reminder_minutes'], 30)

    async def test_all_day_weekly_custom_repeat_stops_at_series_boundary(self):
        start = START.replace(hour=17) - timedelta(days=1)  # Monday midnight Vietnam
        _, event_id = await self.make(is_all_day=True, starts_at=start.isoformat(),
            ends_at=(start+timedelta(days=1)).isoformat(), recurrence='WEEKLY',
            reminder_repeat=True, reminder_at=(START-timedelta(minutes=30)).isoformat())
        _, current = await self.request('GET', '/api/calendar/events/'+event_id)
        code, result = await self.request('DELETE', '/api/calendar/events/'+event_id,
            query={'scope':'FOLLOWING', 'occurrence_at':(start+timedelta(days=14)).isoformat(), 'expected_updated_at':current['updated_at']})
        self.assertEqual(code, 204, result)
        for day in (0, 7, 14, 21): await self.tick(START+timedelta(days=day, minutes=-30))
        async with self.sessions() as db:
            notices = (await db.scalars(select(Notification).where(Notification.event_id==event_id))).all()
        self.assertEqual(len(notices), 2)

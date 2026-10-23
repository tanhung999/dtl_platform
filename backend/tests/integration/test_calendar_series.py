"""Whole-series actions and read-only compatibility with existing calendar exceptions."""
from datetime import datetime, timedelta, timezone
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException
from app.db.models import Note
from app.db.notifications import Notification, NotificationJob
from app.modules.notifications.worker import deliver_batch


class CalendarSeriesTests(ApiTestCase):
    async def test_absolute_series_reminder_remains_one_shot(self):
        code, event = await self.request('POST', payload=self.event_payload(starts_at='2099-01-05T09:00:00+07:00',
            ends_at='2099-01-05T10:00:00+07:00', recurrence='DAILY', reminder_at='2099-01-06T08:45:00+07:00'))
        self.assertEqual(code, 201, event)
        await self.legacy_skip(event)
        async with self.sessions() as db:
            self.assertEqual(await deliver_batch(db, datetime(2099, 1, 6, 1, 45, tzinfo=timezone.utc)), 1)
            await db.commit()
            self.assertEqual(await db.scalar(select(func.count()).select_from(Notification)), 1)
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob).where(NotificationJob.processed_at.is_(None))), 0)

    async def make(self):
        code, event = await self.request('POST', payload=self.event_payload(starts_at='2099-01-05T09:00:00+07:00',
            ends_at='2099-01-05T10:00:00+07:00', recurrence='DAILY', reminder_minutes=15))
        self.assertEqual(code, 201, event)
        return event

    def guard(self, event, at=None):
        return {'occurrence_at': at or event['starts_at'], 'expected_updated_at': event['updated_at']}

    async def test_legacy_skip_filters_grid_counts_and_reminder_chain(self):
        event = await self.make()
        await self.legacy_skip(event)
        query = {'start': '2099-01-05T00:00:00+07:00', 'end': '2099-01-08T00:00:00+07:00'}
        _, page = await self.request('GET', '/api/calendar/events/collection', query=query)
        self.assertEqual(page['total'], 2); self.assertEqual(len(page['items']), 2)
        self.assertEqual(len((await self.request('GET', query=query))[1]), 2)
        _, days = await self.request('GET', '/api/calendar/days', query={'start': '2099-01-05', 'end': '2099-01-08'})
        self.assertEqual([day['events'] for day in days.values()], [0, 1, 1])
        _, next_time = await self.request('GET', '/api/calendar/events/'+event['id']+'/next-reminder', query={'minutes': 15})
        self.assertEqual(datetime.fromisoformat(next_time['at'].replace('Z', '+00:00')), datetime(2099, 1, 6, 1, 45, tzinfo=timezone.utc))
        tick = datetime(2099, 1, 5, 1, 45, tzinfo=timezone.utc)
        async with self.sessions() as db:
            self.assertEqual(await deliver_batch(db, tick), 1); await db.commit()
            self.assertEqual(await db.scalar(select(func.count()).select_from(Notification)), 0)
            job = await db.scalar(select(NotificationJob).where(NotificationJob.processed_at.is_(None)))
            self.assertEqual(job.scheduled_at, tick + timedelta(days=1))
        async with self.sessions() as db:
            self.assertEqual(await deliver_batch(db, tick + timedelta(days=1)), 1); await db.commit()
            self.assertEqual(await db.scalar(select(func.count()).select_from(Notification)), 1)


    async def test_notes_do_not_support_individual_occurrence_actions(self):
        code, note = await self.request('POST', '/api/notes', payload={'title': 'Recurring note', 'content': 'Keep this content',
            'calendar_schedule': {'starts_at': '2099-01-05T09:00:00+07:00', 'ends_at': '2099-01-05T10:00:00+07:00', 'recurrence': 'DAILY', 'reminder_minutes': 15}})
        self.assertEqual(code, 201, note)
        schedule = note['calendar_schedule']; event_id = schedule['event_id']
        guard = {'occurrence_at': schedule['starts_at'], 'expected_updated_at': schedule['expected_updated_at']}
        self.assertEqual((await self.request('POST', '/api/calendar/events/'+event_id+'/occurrence/skip', payload=guard))[0], 404)
        self.assertEqual((await self.request('PUT', '/api/calendar/events/'+event_id+'/occurrence', payload=self.event_payload(**guard)))[0], 404)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarException)), 0)
            self.assertEqual(await db.scalar(select(func.count()).select_from(Note)), 1)
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarEvent)), 1)
        _, saved = await self.request('GET', '/api/notes/'+note['id'])
        self.assertEqual(saved['content'], note['content']); self.assertEqual(saved['version'], note['version'])
        self.assertEqual(saved['calendar_schedule']['recurrence'], 'DAILY')


    async def test_delete_from_series_or_edited_occurrence_removes_all_and_jobs(self):
        for target_child in (False, True):
            with self.subTest(target_child=target_child):
                event = await self.make()
                child = await self.legacy_edit(event)
                _, detail = await self.request('GET', '/api/calendar/events/'+child['id'])
                self.assertTrue(detail['deletion_includes_series'])
                if not target_child:
                    # Turning off recurrence does not sever the deletion link.
                    _, current = await self.request('GET', '/api/calendar/events/'+event['id'])
                    code, _ = await self.request('PUT', '/api/calendar/events/'+event['id'],
                        payload=self.event_payload(starts_at=current['starts_at'], ends_at=current['ends_at'], recurrence='NONE'))
                    self.assertEqual(code, 200)
                    _, current = await self.request('GET', '/api/calendar/events/'+event['id'])
                    self.assertTrue(current['deletion_includes_series'])
                target = child['id'] if target_child else event['id']
                self.assertEqual((await self.request('DELETE', '/api/calendar/events/'+target, user='bob'))[0], 404)
                self.assertEqual((await self.request('DELETE', '/api/calendar/events/'+target,
                    query={'expected_updated_at':'2000-01-01T00:00:00Z'}))[0], 409)
                self.assertEqual((await self.request('GET', '/api/calendar/events/'+event['id']))[0], 200)
                self.assertEqual((await self.request('DELETE', '/api/calendar/events/'+target))[0], 204)
                for event_id in (event['id'], child['id']):
                    self.assertEqual((await self.request('GET', '/api/calendar/events/'+event_id))[0], 404)
                async with self.sessions() as db:
                    self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarException)), 0)
                    self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob)), 0)

    async def test_delete_recurring_note_removes_calendar_and_pending_reminders(self):
        code, note = await self.request('POST', '/api/notes', payload={'title':'Delete series',
            'calendar_schedule':{'starts_at':'2099-01-05T09:00:00+07:00',
            'ends_at':'2099-01-05T10:00:00+07:00', 'recurrence':'DAILY', 'reminder_minutes':15}})
        self.assertEqual(code, 201, note)
        event_id = note['calendar_schedule']['event_id']
        self.assertEqual((await self.request('DELETE', '/api/notes/'+note['id'],
            payload={'expected_version':note['version']+1}))[0], 409)
        self.assertEqual((await self.request('GET', '/api/calendar/events/'+event_id))[0], 200)
        self.assertEqual((await self.request('DELETE', '/api/notes/'+note['id']))[0], 204)
        self.assertEqual((await self.request('GET', '/api/calendar/events/'+event_id))[0], 404)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(NotificationJob)), 0)
            self.assertEqual(await deliver_batch(db, datetime(2099,1,6,1,45,tzinfo=timezone.utc)), 0)

    async def legacy_skip(self, event):
        async with self.sessions() as db:
            db.add(CalendarException(event_id=event['id'], occurrence_at=datetime.fromisoformat(event['starts_at'].replace('Z','+00:00'))))
            await db.commit()

    async def legacy_edit(self, event):
        async with self.sessions() as db:
            child = CalendarEvent(user_id='alice', **self.event_payload(starts_at='2099-01-05T11:00:00+07:00',
                ends_at='2099-01-05T12:00:00+07:00', reminder_minutes=15))
            child.starts_at = datetime.fromisoformat(child.starts_at)
            child.ends_at = datetime.fromisoformat(child.ends_at)
            db.add(child)
            await db.flush()
            db.add(CalendarException(event_id=event['id'], occurrence_at=datetime.fromisoformat(event['starts_at'].replace('Z','+00:00')), replacement_id=child.id))
            from app.modules.notifications.scheduling import sync_event_jobs
            await sync_event_jobs(db, child)
            await db.commit()
            return {'id':child.id}

    async def test_per_occurrence_endpoints_removed_for_events(self):
        event = await self.make()
        path = '/api/calendar/events/'+event['id']+'/occurrence'
        self.assertEqual((await self.request('GET',path,query={'occurrence_at':event['starts_at']}))[0],404)
        self.assertEqual((await self.request('PUT',path,payload=self.event_payload(**self.guard(event))))[0],404)
        self.assertEqual((await self.request('POST',path+'/skip',payload=self.guard(event)))[0],404)
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarException)),0)
            self.assertEqual(await db.scalar(select(func.count()).select_from(CalendarEvent)),1)

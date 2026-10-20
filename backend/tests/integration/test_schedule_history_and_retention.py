"""Lịch sử bao phủ form cũ; dọn dữ liệu không làm yêu cầu cũ chạy lại."""
from datetime import timedelta
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import select, func, delete, text
from tests.support.api_case import ApiTestCase
from app.core.config import settings
from app.db.models import utcnow
from app.db.schedule_changes import ScheduleChange, ScheduleChangeReceipt
from app.db.notifications import NotificationJob
from app.modules.maintenance.cleanup import cleanup_batch


class ScheduleHistoryAndRetentionTests(ApiTestCase):
    async def test_direct_task_event_note_edits_record_once_and_content_edits_do_not(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Task', 'due_date': '2050-01-01'})
        _, event = await self.request('POST', payload=self.event_payload())
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Note', 'calendar_schedule': {
            'starts_at': '2050-01-01T09:00:00+07:00', 'ends_at': '2050-01-01T10:00:00+07:00'}})
        code, task = await self.request('PATCH', '/api/tasks/' + task['id'], payload={'due_date': '2050-01-02'})
        self.assertEqual(code, 200)
        code, event = await self.request('PUT', '/api/calendar/events/' + event['id'], payload=self.event_payload(starts_at='2050-01-02T09:00:00+07:00', ends_at='2050-01-02T10:00:00+07:00'))
        self.assertEqual(code, 200)
        code, note = await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': note['version'], 'calendar_schedule': {
            **note['calendar_schedule'], 'starts_at': '2050-01-02T09:00:00+07:00', 'ends_at': '2050-01-02T10:00:00+07:00'}})
        self.assertEqual(code, 200, note)
        for kind, row in [('task', task), ('event', event), ('note', note)]:
            _, entries = await self.request('GET', f'/api/schedule-changes/{kind}/{row["id"]}')
            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0]['reason'], '')
        await self.request('PATCH', '/api/tasks/' + task['id'], payload={'title': 'New title'})
        await self.request('PATCH', '/api/notes/' + note['id'], payload={'expected_version': note['version'], 'content': 'New content', 'calendar_schedule': note['calendar_schedule']})
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(ScheduleChange)), 3)

    async def test_editing_appointment_via_event_api_records_note_history(self):
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Note', 'calendar_schedule': {
            'starts_at': '2050-01-01T09:00:00+07:00', 'ends_at': '2050-01-01T10:00:00+07:00'}})
        code, _ = await self.request('PUT', '/api/calendar/events/' + note['calendar_schedule']['event_id'], payload=self.event_payload(starts_at='2050-01-03T09:00:00+07:00', ends_at='2050-01-03T10:00:00+07:00'))
        self.assertEqual(code, 200)
        _, entries = await self.request('GET', '/api/schedule-changes/note/' + note['id'])
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]['after']['starts_at'], '2050-01-03T02:00:00+00:00')

    async def test_retention_is_bounded_leaves_pending_jobs_and_blocks_replay_forever(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Retention', 'due_date': '2050-01-01'})
        payload = {'request_id': str(uuid4()), 'expected_version': task['version'], 'due_date': '2050-01-02'}
        _, change = await self.request('POST', '/api/schedule-changes/task/' + task['id'], payload=payload)
        now = utcnow()
        async with self.sessions() as db:
            old = await db.get(ScheduleChange, change['id']); old.created_at = now - timedelta(days=400)
            for i in range(3):
                db.add(NotificationJob(task_id=task['id'], user_id='alice', deadline_version=0, kind='day', event_key='retention:' + str(i),
                    scheduled_at=now-timedelta(days=50), available_at=now-timedelta(days=50), processed_at=now-timedelta(days=40) if i < 2 else None))
            await db.commit()
        with patch.object(settings, 'MAINTENANCE_BATCH_SIZE', 1):
            async with self.sessions() as db:
                removed = await cleanup_batch(db, now); await db.commit()
                self.assertEqual(removed, {'history': 1, 'jobs': 1})
            async with self.sessions() as db:
                self.assertEqual(await cleanup_batch(db, now), {'history': 0, 'jobs': 0}); await db.commit()
            async with self.sessions() as db:
                self.assertEqual((await cleanup_batch(db, now+timedelta(seconds=601)))['jobs'], 1); await db.commit()
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(ScheduleChangeReceipt)), 1)
            pending = await db.scalar(select(NotificationJob.id).where(NotificationJob.event_key == 'retention:2'))
            self.assertIsNotNone(pending)
        code, _ = await self.request('POST', '/api/schedule-changes/task/' + task['id'], payload=payload)
        self.assertEqual(code, 410)

    async def test_migration_backfills_receipts_and_is_repeatable(self):
        from app.db.migrations.retention import migrate_retention
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Migration'})
        payload = {'request_id': str(uuid4()), 'expected_version': task['version'], 'due_date': '2050-01-02'}
        await self.request('POST', '/api/schedule-changes/task/' + task['id'], payload=payload)
        async with self.engine.begin() as conn:
            await conn.execute(delete(ScheduleChangeReceipt))
            await migrate_retention(conn); await migrate_retention(conn)
        code, _ = await self.request('POST', '/api/schedule-changes/task/' + task['id'], payload=payload)
        self.assertEqual(code, 200)

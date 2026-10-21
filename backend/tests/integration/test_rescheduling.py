"""Đổi lịch đúng phiên bản, lịch sử riêng và hoàn tác an toàn."""
from uuid import uuid4
from sqlalchemy import select, func
from tests.support.api_case import ApiTestCase
from app.db.schedule_changes import ScheduleChange
from app.db.notifications import NotificationJob


class ReschedulingTests(ApiTestCase):
    async def task(self):
        code, row = await self.request('POST', '/api/tasks', payload={'title': 'Task', 'description': 'Keep', 'due_date': '2026-10-12', 'due_time': '09:00'})
        self.assertEqual(code, 201)
        return row

    async def test_task_reason_history_replay_reminders_and_undo(self):
        row = await self.task()
        path = '/api/schedule-changes/task/' + row['id']
        payload = {'request_id': str(uuid4()), 'expected_version': row['version'], 'due_date': '2026-10-14', 'due_time': '09:00', 'reason': '  Chờ hồ sơ  '}
        code, moved = await self.request('POST', path, payload=payload)
        self.assertEqual(code, 200, moved)
        self.assertEqual(moved['reason'], 'Chờ hồ sơ')
        code, retry = await self.request('POST', path, payload=payload)
        self.assertEqual(code, 200, retry)
        self.assertEqual(retry['id'], moved['id'])
        _, task = await self.request('GET', '/api/tasks/' + row['id'])
        self.assertEqual(task['description'], 'Keep')
        self.assertEqual(task['deadline_version'], row['deadline_version'] + 1)
        self.assertEqual(task['due_time'], '09:00')
        async with self.sessions() as db:
            jobs = (await db.scalars(select(NotificationJob).where(NotificationJob.task_id == task['id'], NotificationJob.processed_at.is_(None)))).all()
            self.assertEqual(jobs, [])  # No reminder unless the user opts in.
        code, _ = await self.request('GET', path, user='bob')
        self.assertEqual(code, 404)
        code, _ = await self.request('POST', '/api/schedule-changes/records/' + moved['id'] + '/undo', user='bob')
        self.assertEqual(code, 404)
        _, history = await self.request('GET', path)
        self.assertEqual(len(history), 1)
        code, undone = await self.request('POST', '/api/schedule-changes/records/' + moved['id'] + '/undo')
        self.assertEqual(code, 200, undone)
        self.assertIsNotNone(undone['undone_at'])
        code, _ = await self.request('POST', '/api/schedule-changes/records/' + moved['id'] + '/undo')
        self.assertEqual(code, 200)
        _, task = await self.request('GET', '/api/tasks/' + row['id'])
        self.assertEqual(task['due_date'], row['due_date'])
        self.assertEqual(task['version'], row['version'] + 2)

    async def test_stale_move_and_undo_cannot_overwrite_new_edits(self):
        row = await self.task()
        payload = {'request_id': str(uuid4()), 'expected_version': row['version'], 'due_date': '2026-10-14'}
        code, moved = await self.request('POST', '/api/schedule-changes/task/' + row['id'], payload=payload)
        self.assertEqual(code, 200, moved)
        code, _ = await self.request('POST', '/api/schedule-changes/task/' + row['id'], payload={**payload, 'request_id': str(uuid4())})
        self.assertEqual(code, 409)
        await self.request('PATCH', '/api/tasks/' + row['id'], payload={'title': 'Edited afterwards'})
        code, _ = await self.request('POST', '/api/schedule-changes/records/' + moved['id'] + '/undo')
        self.assertEqual(code, 409)

    async def test_event_note_sync_and_preserved_content(self):
        for kind in ['event', 'note']:
            if kind == 'event':
                _, row = await self.request('POST', payload=self.event_payload())
                guard = {'expected_updated_at': row['updated_at']}
            else:
                _, row = await self.request('POST', '/api/notes', payload={'title': 'Note', 'content': 'Keep note', 'calendar_schedule': {'starts_at': '2026-10-12T09:00:00+07:00', 'ends_at': '2026-10-12T10:00:00+07:00'}})
                guard = {'expected_version': row['version'], 'expected_updated_at': row['calendar_schedule']['expected_updated_at']}
            code, moved = await self.request('POST', f'/api/schedule-changes/{kind}/' + row['id'], payload={
                'request_id': str(uuid4()), **guard, 'starts_at': '2026-10-14T09:00:00+07:00', 'ends_at': '2026-10-14T10:00:00+07:00'})
            self.assertEqual(code, 200, moved)
            if kind == 'note':
                _, saved = await self.request('GET', '/api/notes/' + row['id'])
                self.assertEqual(saved['content'], 'Keep note')
                self.assertEqual(saved['calendar_schedule']['starts_at'], '2026-10-14T02:00:00Z')
                code, _ = await self.request('POST', '/api/schedule-changes/event/' + saved['calendar_schedule']['event_id'], payload={
                    'request_id': str(uuid4()), 'expected_updated_at': saved['calendar_schedule']['expected_updated_at'], 'starts_at': '2026-10-15T09:00:00+07:00', 'ends_at': '2026-10-15T10:00:00+07:00'})
                self.assertEqual(code, 409)
            code, result = await self.request('POST', '/api/schedule-changes/records/' + moved['id'] + '/undo')
            self.assertEqual(code, 200, result)

    async def test_validation_and_empty_reason_and_undated_task_undo(self):
        _, row = await self.request('POST', '/api/tasks', payload={'title': 'Undated'})
        path = '/api/schedule-changes/task/' + row['id']
        payload = {'request_id': str(uuid4()), 'expected_version': row['version'], 'due_date': '2026-10-14'}
        for bad in [{'reason': 'x' * 501}, {'due_time': '26:00'}, {'due_date': None}]:
            code, _ = await self.request('POST', path, payload={**payload, **bad})
            self.assertEqual(code, 422)
        code, change = await self.request('POST', path, payload=payload)
        self.assertEqual(code, 200, change)
        self.assertEqual(change['reason'], '')
        code, _ = await self.request('POST', path, payload={**payload, 'reason': 'Different'})
        self.assertEqual(code, 409)
        code, _ = await self.request('POST', '/api/schedule-changes/records/' + change['id'] + '/undo')
        self.assertEqual(code, 200)
        _, task = await self.request('GET', '/api/tasks/' + row['id'])
        self.assertIsNone(task['due_date'])
        async with self.sessions() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(ScheduleChange)), 1)

    async def test_all_day_note_private_and_content_unchanged(self):
        from app.db.models import Note
        from app.db.calendar import CalendarEvent
        _, note = await self.request('POST', '/api/notes', payload={'title': 'Private note', 'content': 'Do not copy', 'calendar_schedule': {
            'starts_at': '2026-10-12T00:00:00+07:00', 'ends_at': '2026-10-15T00:00:00+07:00', 'is_all_day': True}})
        async with self.sessions() as db:
            (await db.get(Note, note['id'])).is_private = True
            (await db.get(CalendarEvent, note['calendar_schedule']['event_id'])).is_private = True
            await db.commit()
        _, note = await self.request('GET', '/api/notes/' + note['id'])
        code, change = await self.request('POST', '/api/schedule-changes/note/' + note['id'], payload={
            'request_id': str(uuid4()), 'expected_version': note['version'], 'expected_updated_at': note['calendar_schedule']['expected_updated_at'],
            'starts_at': '2026-10-22T00:00:00+07:00', 'ends_at': '2026-10-25T00:00:00+07:00', 'is_all_day': True})
        self.assertEqual(code, 200, change)
        _, current = await self.request('GET', '/api/notes/' + note['id'])
        self.assertTrue(current['is_private'])
        self.assertEqual(current['content'], 'Do not copy')
        self.assertEqual(current['calendar_schedule']['starts_at'], '2026-10-21T17:00:00Z')
        self.assertNotIn('content', change['after'])

    async def test_no_op_and_invalid_range_do_not_write_history(self):
        _, event = await self.request('POST', payload=self.event_payload())
        path = '/api/schedule-changes/event/' + event['id']
        payload = {'request_id': str(uuid4()), 'expected_updated_at': event['updated_at'], 'starts_at': event['starts_at'], 'ends_at': event['ends_at']}
        for values in [{}, {'ends_at': event['starts_at']}, {'starts_at': '2026-10-12T09:00:00'}]:
            code, _ = await self.request('POST', path, payload={**payload, **values})
            self.assertEqual(code, 422)
        _, history = await self.request('GET', path)
        self.assertEqual(history, [])
        _, current = await self.request('GET', '/api/calendar/events/' + event['id'])
        self.assertEqual(current['updated_at'], event['updated_at'])

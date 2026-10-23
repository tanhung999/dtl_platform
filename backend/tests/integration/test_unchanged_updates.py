"""Lưu không thay đổi không ghi dữ liệu, nhưng vẫn kiểm tra quyền và phiên bản."""
from contextlib import contextmanager
from sqlalchemy import event
from tests.support.api_case import ApiTestCase


class UnchangedUpdateTests(ApiTestCase):
    @contextmanager
    def writes(self):
        statements = []
        def observe(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().split()[0].upper() in ('INSERT', 'UPDATE', 'DELETE'):
                statements.append(statement)
        event.listen(self.engine.sync_engine, 'before_cursor_execute', observe)
        try:
            yield statements
        finally:
            event.remove(self.engine.sync_engine, 'before_cursor_execute', observe)

    async def test_task_noop_keeps_version_jobs_and_timestamp(self):
        _, task = await self.request('POST', '/api/tasks', payload={'title': 'Task', 'due_date': '2050-01-01'})
        path = '/api/tasks/' + task['id']
        with self.writes() as writes:
            code, saved = await self.request('PATCH', path, payload={
                'title': ' Task ', 'description': '', 'priority': task['priority'],
                'is_private': False, 'due_date': task['due_date'], 'due_time': None, 'expected_version': task['version']})
        self.assertEqual(code, 200)
        self.assertEqual(saved, task)
        self.assertEqual(writes, [])
        await self.request('PATCH', path, payload={'title': 'Changed', 'expected_version': task['version']})
        self.assertEqual((await self.request('PATCH', path, payload={'title': 'Changed', 'expected_version': task['version']}))[0], 409)

    async def test_event_noop_normalizes_timezone_and_keeps_timestamp(self):
        _, row = await self.request('POST', payload=self.event_payload())
        path = '/api/calendar/events/' + row['id']
        payload = self.event_payload(starts_at=row['starts_at'], ends_at=row['ends_at'], expected_updated_at=row['updated_at'])
        with self.writes() as writes:
            code, saved = await self.request('PUT', path, payload=payload)
        self.assertEqual(code, 200)
        self.assertEqual(saved, row)
        self.assertEqual(writes, [])
        await self.request('PUT', path, payload={**payload, 'title': 'Changed'})
        self.assertEqual((await self.request('PUT', path, payload={**payload, 'title': 'Changed'}))[0], 409)

    async def test_note_noop_with_or_without_schedule_does_not_write(self):
        for schedule in (None, {'starts_at': '2050-01-01T09:00:00+07:00', 'ends_at': '2050-01-01T10:00:00+07:00'}):
            _, row = await self.request('POST', '/api/notes', payload={'title': 'Note', **({'calendar_schedule': schedule} if schedule else {})})
            path = '/api/notes/' + row['id']
            payload = {key: row[key] for key in ('title', 'content', 'color', 'is_pinned', 'is_private', 'is_archived')}
            payload['expected_version'] = row['version']
            if schedule: payload['calendar_schedule'] = row['calendar_schedule']
            with self.writes() as writes:
                code, saved = await self.request('PATCH', path, payload=payload)
            self.assertEqual(code, 200)
            self.assertEqual(saved, row)
            self.assertEqual(writes, [])
            self.assertEqual((await self.request('PATCH', path, user='bob', payload=payload))[0], 404)
            _, updated = await self.request('PATCH', path, payload={**payload, 'content': 'Changed'})
            self.assertEqual(updated['version'], row['version'] + 1)
            self.assertEqual(updated['calendar_schedule'], row['calendar_schedule'])
            self.assertEqual((await self.request('PATCH', path, payload={**payload, 'content': 'Changed'}))[0], 409)

    async def test_unchanged_note_still_rejects_stale_schedule_guard(self):
        _, row = await self.request('POST', '/api/notes', payload={'title': 'Note', 'calendar_schedule': {
            'starts_at': '2050-01-01T09:00:00+07:00', 'ends_at': '2050-01-01T10:00:00+07:00'}})
        schedule = {**row['calendar_schedule'], 'expected_updated_at': '2000-01-01T00:00:00Z'}
        code, _ = await self.request('PATCH', '/api/notes/' + row['id'], payload={
            'expected_version': row['version'], 'calendar_schedule': schedule})
        self.assertEqual(code, 409)

    async def test_profile_noop_does_not_update_timestamp(self):
        _, user = await self.request('GET', '/api/auth/me')
        with self.writes() as writes:
            code, saved = await self.request('PUT', '/api/auth/profile', payload={'full_name': ' Alice ', 'phone': user['phone']})
        self.assertEqual(code, 200)
        self.assertEqual(saved, user)
        self.assertEqual(writes, [])

    async def test_preferences_noop_preserves_default_and_existing_version(self):
        for enabled in (True, False):
            _, current = await self.request('GET', '/api/notifications/preferences')
            if current['task_reminders'] != enabled:
                _, current = await self.request('PATCH', '/api/notifications/preferences', payload={
                    'task_reminders': enabled, 'expected_version': current['version']})
            with self.writes() as writes:
                code, saved = await self.request('PATCH', '/api/notifications/preferences', payload={
                    'task_reminders': enabled, 'expected_version': current['version']})
            self.assertEqual(code, 200)
            self.assertEqual(saved, current)
            self.assertEqual(writes, [])

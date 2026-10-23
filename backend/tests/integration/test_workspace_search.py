from datetime import datetime, timezone
from sqlalchemy import select, text
from tests.support.api_case import ApiTestCase
from app.db.models import User, Task, Note
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.migrations.event_search import migrate_event_search


class WorkspaceSearchTests(ApiTestCase):
    async def seed(self):
        async with self.sessions() as db:
            alice = await db.get(User, 'alice')
            alice.allowed_apps = 'workflows'
            for owner in ('alice', 'bob'):
                db.add(Task(user_id=owner, title='Công việc', description='Đánh giá ngân sách', is_private=True))
                db.add(Note(user_id=owner, title='Ghi chú', content='Đánh giá ngân sách', is_private=True))
                db.add(CalendarEvent(user_id=owner, title='Cuộc họp', description='Đánh giá ngân sách', location='Phòng Đà Nẵng',
                    starts_at=datetime(2026, 10, 20, 2, tzinfo=timezone.utc), ends_at=datetime(2026, 10, 20, 3, tzinfo=timezone.utc)))
            db.add(Note(user_id='alice', title='Đánh giá ngân sách', is_archived=True))
            note = Note(user_id='alice', title='Đánh giá ngân sách gắn lịch')
            event = CalendarEvent(user_id='alice', title='Đánh giá ngân sách gắn lịch', starts_at=datetime(2026,10,20,4,tzinfo=timezone.utc), ends_at=datetime(2026,10,20,5,tzinfo=timezone.utc))
            db.add_all([note,event]); await db.flush()
            db.add(NoteCalendarSchedule(note_id=note.id, event_id=event.id))
            await db.commit()

    async def test_search_content_accent_permissions_and_no_duplicate_scheduled_note(self):
        await self.seed()
        status, result = await self.request('GET', '/api/search', query={'q':'danh gia ngan sach'})
        self.assertEqual(status,200)
        self.assertEqual({kind: group['total'] for kind, group in result['groups'].items()}, {'apps':0,'tasks':1,'notes':2,'events':1})
        _, location = await self.request('GET','/api/search',query={'q':'da nang'})
        self.assertEqual(location['groups']['events']['total'],1)
        _, apps = await self.request('GET','/api/search',query={'q':'trinh ky'})
        self.assertEqual([item['id'] for item in apps['groups']['apps']['items']],['workflows'])
        _, branded = await self.request('GET', '/api/search', query={'q': 'DT Workflow'})
        self.assertEqual([(item['id'], item['title']) for item in branded['groups']['apps']['items']], [('workflows', 'DT Workflow')])
        _, branded_forbidden = await self.request('GET', '/api/search', query={'q': 'DT Assets'})
        self.assertEqual(branded_forbidden['groups']['apps']['total'], 0)
        _, forbidden = await self.request('GET','/api/search',query={'q':'tai san'})
        self.assertEqual(forbidden['groups']['apps']['total'],0)
        status, _ = await self.request('GET','/api/search', user=None, query={'q':'ngan sach'})
        self.assertEqual(status,401)

    async def test_limits_literal_wildcards_live_updates_and_validation(self):
        await self.seed()
        async with self.sessions() as db:
            db.add_all([Task(user_id='alice',title=f'Phần trăm %_ {i}') for i in range(23)])
            await db.commit()
        _, page = await self.request('GET','/api/search',query={'q':'%_', 'kind':'tasks','offset':20,'limit':20})
        self.assertEqual(page['groups']['tasks']['total'],23)
        self.assertEqual(len(page['groups']['tasks']['items']),3)
        _, clamped = await self.request('GET','/api/search',query={'q':'%_', 'kind':'tasks','offset':100,'limit':20})
        self.assertEqual(clamped['offset'],20)
        self.assertEqual(len(clamped['groups']['tasks']['items']),3)
        _, short = await self.request('GET','/api/search',query={'q':'a'})
        self.assertTrue(all(group['total']==0 for group in short['groups'].values()))
        for query in ({'q':'x'*201},{'q':'ngan','limit':51},{'q':'ngan','offset':-1},{'q':'ngan','kind':'unknown'}):
            status,_ = await self.request('GET','/api/search',query=query)
            self.assertEqual(status,422)
        async with self.sessions() as db:
            event=await db.scalar(select(CalendarEvent).where(CalendarEvent.user_id=='alice',CalendarEvent.title=='Cuộc họp'))
            event.description='Nội dung cập nhật khác'
            await db.commit()
        _, old = await self.request('GET','/api/search',query={'q':'ngan sach','kind':'events'})
        self.assertEqual(old['groups']['events']['total'],0)
        _, new = await self.request('GET','/api/search',query={'q':'cap nhat khac','kind':'events'})
        self.assertEqual(new['groups']['events']['total'],1)

    async def test_migration_backfills_existing_event_without_changing_original_data(self):
        await self.seed()
        async with self.engine.begin() as conn:
            await conn.execute(text("UPDATE calendar_events SET search_text=''"))
            await migrate_event_search(conn)
            await migrate_event_search(conn)
            rows=(await conn.execute(text("SELECT title, search_text FROM calendar_events WHERE title='Cuộc họp'"))).all()
            self.assertTrue(all('danh gia ngan sach' in row.search_text for row in rows))
            self.assertTrue(all(row.title=='Cuộc họp' for row in rows))

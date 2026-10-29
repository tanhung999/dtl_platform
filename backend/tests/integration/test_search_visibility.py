from datetime import datetime, timezone, date
from sqlalchemy import delete
from tests.support.api_case import ApiTestCase
from app.db.models import User, Task, TaskFollower, Note
from app.db.calendar import CalendarEvent, CalendarEventFollower
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.access import AccessRole, AccessPermission, RolePermission, UserRole, CalendarShare
from app.db.applications import Application, UserApplicationAccess
from app.modules.access.service import SHARE


class SearchVisibilityTests(ApiTestCase):
    async def search(self, kind='all'):
        status, result = await self.request('GET', '/api/search', query={'q': 'kiem thu', 'kind': kind})
        self.assertEqual(status, 200)
        return result['groups']

    async def shared_fixture(self):
        async with self.sessions() as db:
            db.add_all([AccessRole(id='sharer', name='Sharer'), AccessPermission(code=SHARE, name='Share')])
            await db.flush()
            db.add_all([UserRole(user_id='bob', role_id='sharer'), RolePermission(role_id='sharer', permission_code=SHARE)])
            grant = CalendarShare(owner_id='bob', viewer_id='alice', share_tasks=True, share_events=True, share_notes=True)
            task = Task(user_id='bob', title='Kiểm thử công việc', due_date=date(2026, 10, 29))
            event = CalendarEvent(user_id='bob', title='Kiểm thử sự kiện', starts_at=datetime(2026,10,29,2,tzinfo=timezone.utc), ends_at=datetime(2026,10,29,3,tzinfo=timezone.utc))
            note = Note(user_id='bob', title='Kiểm thử ghi chú', content='Nội dung được chia sẻ')
            schedule = CalendarEvent(user_id='bob', title=note.title, starts_at=event.starts_at, ends_at=event.ends_at)
            db.add_all([grant, task, event, note, schedule,
                Task(user_id='bob', title='Kiểm thử chưa có hạn'),
                Task(user_id='bob', title='Kiểm thử riêng tư', due_date=date(2026,10,29), is_private=True),
                Note(user_id='bob', title='Kiểm thử chưa gắn lịch')])
            await db.flush()
            db.add(NoteCalendarSchedule(note_id=note.id, event_id=schedule.id))
            await db.commit()
            return grant.id, task.id, event.id, note.id, schedule.id

    async def test_assigned_and_followed_items_are_searchable_without_sharing_or_duplicates(self):
        async with self.sessions() as db:
            task = Task(user_id='bob', assignee_id='alice', title='Kiểm thử giao việc', is_private=True)
            event = CalendarEvent(user_id='bob', title='Kiểm thử theo dõi', is_private=True,
                starts_at=datetime(2026,10,29,2,tzinfo=timezone.utc), ends_at=datetime(2026,10,29,3,tzinfo=timezone.utc))
            db.add_all([task, event, Task(user_id='bob', title='Kiểm thử không được xem')])
            await db.flush()
            db.add_all([TaskFollower(task_id=task.id, user_id='alice', added_by_id='bob'),
                CalendarEventFollower(event_id=event.id, user_id='alice', added_by_id='bob')])
            await db.commit()
        groups = await self.search()
        for kind in ('tasks', 'events'):
            self.assertEqual(groups[kind]['total'], 1)
            self.assertFalse(groups[kind]['items'][0]['shared_only'])
            self.assertEqual(groups[kind]['items'][0]['owner_id'], 'bob')

    async def test_shared_results_respect_category_privacy_and_open_read_only_details(self):
        grant_id, task_id, event_id, note_id, schedule_id = await self.shared_fixture()
        groups = await self.search()
        self.assertEqual({kind: value['total'] for kind, value in groups.items()}, {'apps':0,'tasks':1,'events':1,'notes':1})
        for kind in ('tasks', 'events', 'notes'):
            self.assertTrue(groups[kind]['items'][0]['shared_only'])
            self.assertEqual(groups[kind]['items'][0]['owner_name'], 'Bob')
        self.assertEqual(groups['notes']['items'][0]['item_id'], schedule_id)
        for kind, item_id in [('task', task_id), ('event', event_id), ('note', schedule_id)]:
            status, _ = await self.request('GET', f'/api/calendar-sharing/view/bob/{kind}/{item_id}')
            self.assertEqual(status, 200)
        self.assertEqual((await self.request('GET', '/api/tasks/' + task_id))[0], 404)
        async with self.sessions() as db:
            grant = await db.get(CalendarShare, grant_id)
            grant.share_tasks = grant.share_notes = False
            await db.commit()
        groups = await self.search()
        self.assertEqual([groups[kind]['total'] for kind in ('tasks','notes','events')], [0,0,1])

    async def test_shared_visibility_is_lost_on_revoke_owner_lock_or_capability_removal(self):
        grant_id, *_ = await self.shared_fixture()
        for reason in ('revoke', 'lock', 'capability'):
            async with self.sessions() as db:
                grant = await db.get(CalendarShare, grant_id)
                owner = await db.get(User, 'bob')
                if reason == 'revoke': grant.revoked_at = datetime.now(timezone.utc)
                if reason == 'lock': owner.is_active = False
                if reason == 'capability': await db.execute(delete(UserRole).where(UserRole.user_id=='bob'))
                await db.commit()
            groups = await self.search()
            self.assertTrue(all(value['total'] == 0 for value in groups.values()), reason)
            async with self.sessions() as db:
                (await db.get(CalendarShare, grant_id)).revoked_at = None
                (await db.get(User, 'bob')).is_active = True
                await db.commit()

    async def test_private_note_or_private_schedule_never_leaks_shared_note_text(self):
        _, _, _, note_id, schedule_id = await self.shared_fixture()
        for model, item_id in ((Note, note_id), (CalendarEvent, schedule_id)):
            async with self.sessions() as db:
                (await db.get(model, item_id)).is_private = True
                await db.commit()
            self.assertEqual((await self.search('notes'))['notes']['total'], 0)
            async with self.sessions() as db:
                (await db.get(model, item_id)).is_private = False
                await db.commit()

    async def test_app_search_shows_denied_and_inactive_apps_without_granting_launch(self):
        async with self.sessions() as db:
            for key, active in [('allowed',True), ('denied',True), ('inactive',False)]:
                db.add(Application(key=key,display_name='Kiểm thử '+key,description='',icon_key='platform',
                    launch_url='https://'+key+'.test',permission_prefix=key,is_active=active))
            await db.flush()
            db.add(UserApplicationAccess(user_id='alice',application_key='allowed'))
            await db.commit()
        apps = (await self.search('apps'))['apps']
        self.assertEqual(apps['total'], 3)
        self.assertEqual({item['application']['key'] for item in apps['items']}, {'allowed','denied','inactive'})
        status, page = await self.request('GET','/api/search',query={'q':'kiem thu','kind':'apps','offset':99,'limit':1})
        self.assertEqual(status, 200)
        self.assertEqual(page['offset'], 2)
        self.assertEqual(len(page['groups']['apps']['items']), 1)
        for key, expected in [('allowed',200),('denied',403),('inactive',503)]:
            self.assertEqual((await self.request('POST','/api/sso/launch',payload={'target_app':key}))[0],expected)

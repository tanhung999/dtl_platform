"""Directional reminder delivery and live privacy checks for calendar viewers."""
from unittest.mock import patch
from sqlalchemy import select, delete
from tests.support.api_case import ApiTestCase
from tests.integration import test_user_reminders as reminders
NOW, START = reminders.NOW, reminders.START
from app.db.models import User
from app.db.access import UserRole
from app.db.notifications import Notification, NotificationPreference
from app.db.workspace_versions import WorkspaceVersion
from app.modules.access.service import seed_catalog
from app.core.realtime import mark_changed, prepare_changes


class SharedReminderTests(ApiTestCase):
    task = reminders.UserReminderTests.task
    event = reminders.UserReminderTests.event
    note = reminders.UserReminderTests.note
    tick = reminders.UserReminderTests.tick

    async def asyncSetUp(self):
        await super().asyncSetUp()
        for name in ('app.modules.notifications.scheduling.utcnow', 'app.modules.tasks.router.utcnow'):
            clock = patch(name, return_value=NOW)
            clock.start(); self.addCleanup(clock.stop)
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add_all([UserRole(user_id='alice', role_id='calendar_sharer'), UserRole(user_id='bob', role_id='calendar_sharer')])
            alice = await db.get(User, 'alice'); alice.job_title = 'Tổng Giám Đốc'
            bob = await db.get(User, 'bob'); bob.job_title = ''
            await db.commit()

    async def share(self, owner='alice', viewer='bob', **scope):
        code, grant = await self.request('PUT', '/api/calendar-sharing/mine/'+viewer, user=owner,
            payload={'expected_version':0, 'share_events':True, 'share_tasks':True, 'share_notes':True, **scope})
        self.assertEqual(code,200,grant)
        return grant

    async def feed(self, user='alice', **query):
        code, data = await self.request('GET','/api/notifications',user=user,query=query)
        self.assertEqual(code,200,data)
        return [row for row in data['items'] if row['resource_type'] in ('task','event','note')]

    async def test_direction_labels_all_three_and_independent_read_state(self):
        await self.share()
        await self.task(reminder_minutes=30); await self.event(reminder_minutes=30); await self.note(reminder_minutes=30)
        code, own = await self.request('POST','/api/tasks',user='bob',payload={'title':'Secretary',
            'due_date':'2026-10-20','due_time':'09:00','reminder_minutes':30})
        self.assertEqual(code,201,own)
        self.assertEqual(await self.tick(START),4)
        self.assertEqual(await self.tick(START),0)
        alice, bob = await self.feed(), await self.feed('bob')
        self.assertEqual(len(alice),3); self.assertEqual(len(bob),4)
        self.assertTrue(all(n['ownership_label'] is None for n in alice))
        self.assertEqual({n['ownership_label'] for n in bob},{'Của bạn','Của Tổng Giám Đốc'})
        shared = next(n for n in bob if n['calendar_owner_id'])
        self.assertEqual((await self.request('GET',f"/api/notifications/{shared['id']}/destination",user='bob'))[1],{'calendar_owner_id':'alice'})
        self.assertEqual((await self.request('POST',f"/api/notifications/{shared['id']}/snooze",user='bob'))[0],409)
        await self.request('PATCH',f"/api/notifications/{shared['id']}",user='bob',payload={'read':True,'dismissed':True})
        self.assertTrue(all(n['read_at'] is None and n['dismissed_at'] is None for n in await self.feed()))

    async def test_private_task_event_note_only_owner_and_scope_note_not_event(self):
        await self.share(share_events=False,share_tasks=False)
        await self.task(reminder_minutes=30,is_private=True)
        await self.event(reminder_minutes=30,is_private=True)
        private_note = await self.note(reminder_minutes=30)
        await self.request('PATCH','/api/notes/'+private_note['id'],payload={'expected_version':private_note['version'],'is_private':True})
        await self.task(reminder_minutes=30); await self.event(reminder_minutes=30); note = await self.note(reminder_minutes=30)
        await self.tick(START)
        self.assertEqual(len(await self.feed()),6)
        bob=await self.feed('bob'); self.assertEqual([n['resource_id'] for n in bob],[note['id']])

    async def test_privacy_after_delivery_hides_feed_hidden_summary_and_actions(self):
        await self.share()
        task = await self.task(reminder_minutes=30); event=await self.event(reminder_minutes=30); note=await self.note(reminder_minutes=30)
        await self.tick(START)
        notices=await self.feed('bob'); self.assertEqual(len(notices),3)
        for n in notices:
            await self.request('PATCH',f"/api/notifications/{n['id']}",user='bob',payload={'dismissed':True})
        await self.request('PATCH','/api/tasks/'+task['id'],payload={'is_private':True})
        await self.request('PUT','/api/calendar/events/'+event['id'],payload={**self.event_payload(starts_at=event['starts_at'],ends_at=event['ends_at']), 'is_private':True})
        await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'is_private':True})
        self.assertEqual(await self.feed('bob',filter='hidden'),[])
        self.assertEqual((await self.request('GET','/api/notifications/summary',user='bob'))[1]['unread_count'],1) # share invitation only
        for n in notices:
            for method,suffix,payload in [('GET','/destination',None),('PATCH','',{'read':True}),('POST','/snooze',None)]:
                self.assertEqual((await self.request(method,f"/api/notifications/{n['id']}"+suffix,user='bob',payload=payload))[0],404)
        self.assertEqual(len(await self.feed()),3)

    async def test_scope_change_revoke_and_capability_removal_recheck(self):
        grant=await self.share(); await self.task(reminder_minutes=30); await self.event(reminder_minutes=30)
        await self.tick(START)
        code,updated=await self.request('PUT','/api/calendar-sharing/mine/bob',payload={
            'expected_version':grant['version'],'expected_id':grant['id'],'share_tasks':False,'share_notes':False,'share_events':True})
        self.assertEqual(code,200,updated)
        self.assertEqual([n['resource_type'] for n in await self.feed('bob')],['event'])
        async with self.sessions() as db:
            await db.execute(delete(UserRole).where(UserRole.user_id=='alice',UserRole.role_id=='calendar_sharer')); await db.commit()
        self.assertEqual(await self.feed('bob'),[])
        self.assertFalse((await self.request('GET','/api/notifications/summary',user='bob'))[1]['has_shared_calendars'])

    async def test_no_transitive_delivery_and_two_way_requires_explicit_grant(self):
        async with self.sessions() as db:
            db.add(User(id='charlie',username='charlie',email='charlie@example.com',full_name='Charlie',password_hash='unused'))
            await db.commit()
        await self.share(); await self.share(owner='bob',viewer='charlie')
        await self.task(reminder_minutes=30); await self.tick(START)
        async with self.sessions() as db:
            count=(await db.scalars(select(Notification).where(Notification.user_id=='charlie',Notification.resource_type=='task'))).all()
            self.assertEqual(count,[])
        await self.share(owner='bob',viewer='alice')
        await self.request('POST','/api/tasks',user='bob',payload={'title':'Shared back','due_date':'2026-10-20','due_time':'09:00','reminder_minutes':30})
        await self.tick(START)
        self.assertEqual({n['ownership_label'] for n in await self.feed()},{'Của bạn','Của Bob'})

    async def test_muted_owner_does_not_mute_viewer_and_muted_viewer_is_respected(self):
        await self.share()
        async with self.sessions() as db:
            db.add(NotificationPreference(user_id='alice',task_reminders=False)); await db.commit()
        await self.task(reminder_minutes=30); await self.tick(START)
        self.assertEqual(await self.feed(),[]); self.assertEqual(len(await self.feed('bob')),1)
        async with self.sessions() as db:
            db.add(NotificationPreference(user_id='bob',task_reminders=False)); await db.commit()
        await self.event(reminder_minutes=30); await self.tick(START)
        self.assertEqual(len(await self.feed('bob')),1)

    async def test_revoked_before_due_and_new_grant_do_not_replay_history(self):
        grant=await self.share(); await self.task(reminder_minutes=30)
        code,_=await self.request('DELETE','/api/calendar-sharing/mine/bob',query={'expected_version':grant['version'],'expected_id':grant['id']})
        self.assertEqual(code,204)
        await self.tick(START); self.assertEqual(await self.feed('bob'),[])
        await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':2,'expected_id':grant['id'],'share_tasks':True})
        self.assertEqual(await self.tick(START),0); self.assertEqual(await self.feed('bob'),[])

    async def test_realtime_notification_invalidation_for_private_edits_and_revoke(self):
        await self.share()
        async with self.sessions() as db:
            async def version():
                return await db.scalar(select(WorkspaceVersion.notifications).where(WorkspaceVersion.user_id=='bob'))
            before = await version()
            mark_changed(db,'alice','calendar-privacy'); await prepare_changes(db)
            self.assertEqual(await version(),before+1)
            mark_changed(db,'bob','calendar-sharing'); await prepare_changes(db)
            self.assertEqual(await version(),before+2)

    async def test_all_private_items_not_delivered_even_when_all_scopes_shared(self):
        await self.share()
        await self.task(reminder_minutes=30,is_private=True)
        await self.event(reminder_minutes=30,is_private=True)
        note=await self.note(reminder_minutes=30)
        code,row=await self.request('PATCH','/api/notes/'+note['id'],payload={'expected_version':note['version'],'is_private':True})
        self.assertEqual(code,200,row)
        await self.tick(START)
        self.assertEqual(len(await self.feed()),3)
        self.assertEqual(await self.feed('bob'),[])

    async def test_deleted_resources_hide_shared_history_but_keep_owner_history(self):
        await self.share()
        task=await self.task(reminder_minutes=30); note=await self.note(reminder_minutes=30); event=await self.event(reminder_minutes=30)
        await self.tick(START)
        await self.request('DELETE','/api/tasks/'+task['id'])
        await self.request('DELETE','/api/notes/'+note['id'])
        await self.request('DELETE','/api/calendar/events/'+event['id'])
        self.assertEqual(await self.feed('bob'),[])
        self.assertEqual({n['state'] for n in await self.feed()},{'deleted'})

    async def test_inactive_owner_jobs_do_not_block_queue_or_leak_to_viewer(self):
        await self.share(); await self.task(reminder_minutes=30)
        async with self.sessions() as db:
            owner=await db.get(User,'alice'); owner.is_active=False; await db.commit()
        self.assertEqual(await self.tick(START),1)
        self.assertEqual(await self.tick(START),0)
        self.assertEqual(await self.feed('bob'),[])

"""Sharing grants, privacy, immutable viewer access and invalidation boundaries."""
from tests.support.api_case import ApiTestCase
from sqlalchemy import select
from app.db.access import UserRole, CalendarShare
from app.db.notifications import Notification
from app.modules.access.service import seed_catalog
from app.core.realtime import mark_changed, prepare_changes

class CalendarSharingTests(ApiTestCase):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        async with self.sessions() as db:
            await seed_catalog(db)
            db.add(UserRole(user_id='alice', role_id='access_admin'))
            await db.commit()
        self.query = {'start':'2026-10-12T00:00:00+07:00','end':'2026-10-19T00:00:00+07:00'}

    async def enable(self):
        _, current = await self.request('GET', '/api/access/users/alice')
        code, _ = await self.request('PUT', '/api/access/users/alice/calendar-sharing', payload={'enabled':True,'expected_enabled':False,'expected_version':current['access_version']})
        self.assertEqual(code,200)

    async def share(self, **flags):
        code, value = await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0,**flags})
        self.assertEqual(code,200,value)
        return value

    async def event(self, private=False):
        code, row = await self.request('POST',payload={'title':'Private' if private else 'Visible','starts_at':'2026-10-16T09:00:00+07:00','ends_at':'2026-10-16T10:00:00+07:00','is_private':private})
        self.assertEqual(code,201,row)
        return row

    async def test_explicit_capability_required_and_admin_has_no_implicit_visibility(self):
        code, caps = await self.request('GET','/api/access/me')
        self.assertEqual(caps,{'can_share':False,'can_manage':True})
        code, _ = await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0})
        self.assertEqual(code,403)
        code, _ = await self.request('PUT','/api/access/users/alice/calendar-sharing',user='bob',payload={'enabled':True,'expected_enabled':False,'expected_version':0})
        self.assertEqual(code,403)
        code, _ = await self.request('GET','/api/calendar-sharing/view/bob',query=self.query)
        self.assertEqual(code,404)
        code, found = await self.request('GET','/api/access/users',query={'q':'Bo'}); self.assertEqual(code,200); self.assertEqual(found[0]['id'],'bob')
        code, _ = await self.request('GET','/api/access/users',user='bob',query={'q':'Al'})
        self.assertEqual(code,403)

    async def test_private_hidden_in_grid_counts_and_detail_and_default_off(self):
        await self.enable(); await self.share()
        public, private = await self.event(), await self.event(True)
        self.assertFalse(public['is_private'])
        code, saved = await self.request('PUT', f"/api/calendar/events/{private['id']}", payload={
            'title':'Private edited by old client', 'starts_at':private['starts_at'], 'ends_at':private['ends_at']})
        self.assertEqual(code,200); self.assertTrue(saved['is_private'])
        code, page = await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query)
        self.assertEqual(code,200,page); self.assertEqual(page['total'],1)
        self.assertEqual([x['id'] for x in page['items']],[public['id']])
        code, _ = await self.request('GET',f"/api/calendar-sharing/view/alice/event/{private['id']}",user='bob'); self.assertEqual(code,404)
        code, detail = await self.request('GET',f"/api/calendar-sharing/view/alice/event/{public['id']}",user='bob'); self.assertEqual(code,200)
        code, _ = await self.request('GET',f"/api/calendar/events/{public['id']}",user='bob'); self.assertEqual(code,404)
        code, _ = await self.request('DELETE',f"/api/calendar/events/{public['id']}",user='bob'); self.assertEqual(code,404)

    async def test_scopes_only_dated_tasks_and_scheduled_notes(self):
        await self.enable(); share = await self.share(share_events=False,share_tasks=True)
        event=await self.event()
        _, task = await self.request('POST','/api/tasks',payload={'title':'Dated','due_date':'2026-10-16'})
        _, undated = await self.request('POST','/api/tasks',payload={'title':'Undated'})
        _, note = await self.request('POST','/api/notes',payload={'title':'Note','content':'secret note body','calendar_schedule':{'starts_at':'2026-10-16T11:00:00+07:00','ends_at':'2026-10-16T11:30:00+07:00','is_all_day':False}})
        _, page = await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query)
        self.assertEqual([x['id'] for x in page['items']],[task['id']])
        for kind, id in [('note',note['calendar_schedule']['event_id']),('event',event['id']),('task',undated['id'])]:
            code, _ = await self.request('GET',f'/api/calendar-sharing/view/alice/{kind}/{id}',user='bob'); self.assertEqual(code,404)
        code, _ = await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':share['version'],'expected_id':share['id'],'share_events':False,'share_tasks':False,'share_notes':True}); self.assertEqual(code,200)
        _, page = await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query)
        self.assertEqual(len(page['items']),1); self.assertEqual(page['items'][0]['kind'],'note'); self.assertNotIn('content',page['items'][0])
        code, detail = await self.request('GET',f"/api/calendar-sharing/view/alice/note/{note['calendar_schedule']['event_id']}",user='bob'); self.assertEqual(detail['content'],'secret note body')

    async def test_revoke_capability_deletes_grants_and_does_not_resurrect(self):
        await self.enable(); await self.share()
        code, rows = await self.request('GET','/api/calendar-sharing/received',user='bob'); self.assertEqual(len(rows),1)
        code, _ = await self.request('PUT','/api/access/users/alice/calendar-sharing',payload={'enabled':False,'expected_enabled':True,'expected_version':1}); self.assertEqual(code,200)
        _, rows = await self.request('GET','/api/calendar-sharing/received',user='bob'); self.assertEqual(rows,[])
        code, _ = await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query); self.assertEqual(code,404)
        await self.enable()
        _, rows = await self.request('GET','/api/calendar-sharing/received',user='bob'); self.assertEqual(rows,[])

    async def test_versions_retries_notification_and_revoke(self):
        await self.enable(); row = await self.share()
        retried = await self.share(); self.assertEqual(row['id'],retried['id'])
        async with self.sessions() as db:
            notifications = (await db.scalars(select(Notification).where(Notification.user_id=='bob'))).all(); self.assertEqual(len(notifications),1)
            notification_id = notifications[0].id
        code, destination = await self.request('GET',f'/api/notifications/{notification_id}/destination',user='bob'); self.assertEqual(destination,{'calendar_owner_id':'alice'})
        code, _ = await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0,'share_tasks':True}); self.assertEqual(code,409)
        code, _ = await self.request('DELETE','/api/calendar-sharing/mine/bob',query={'expected_version':0,'expected_id':row['id']}); self.assertEqual(code,409)
        code, _ = await self.request('DELETE','/api/calendar-sharing/mine/bob',query={'expected_version':row['version'],'expected_id':row['id']}); self.assertEqual(code,204)
        code, _ = await self.request('GET',f'/api/notifications/{notification_id}/destination',user='bob'); self.assertEqual(code,404)

    async def test_invalidation_fans_out_without_content(self):
        await self.enable(); await self.share()
        async with self.sessions() as db:
            mark_changed(db,'alice','calendar'); mark_changed(db,'alice','notes')
            changes=await prepare_changes(db)
            self.assertEqual(changes['bob'],{'shared-calendar','notifications'})

    async def test_scope_validation_and_interval_limit(self):
        await self.enable()
        code, _ = await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0,'share_events':False}); self.assertEqual(code,422)
        code, _ = await self.request('PUT','/api/calendar-sharing/mine/alice',payload={'expected_version':0}); self.assertEqual(code,422)
        await self.share()
        code, _ = await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query={'start':'2026-01-01T00:00:00Z','end':'2027-01-01T00:00:00Z'}); self.assertEqual(code,422)


    async def test_revoke_rejects_old_create_and_allows_explicit_fresh_grant(self):
        await self.enable(); original=await self.share()
        args={'expected_version':original['version'],'expected_id':original['id']}
        code,_=await self.request('DELETE','/api/calendar-sharing/mine/bob',query=args);self.assertEqual(code,204)
        code,_=await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':0});self.assertEqual(code,409)
        _,received=await self.request('GET','/api/calendar-sharing/received',user='bob');self.assertEqual(received,[])
        _,state=await self.request('GET','/api/calendar-sharing/mine/bob');self.assertFalse(state['active']);self.assertEqual(state['version'],2)
        code,new=await self.request('PUT','/api/calendar-sharing/mine/bob',payload={'expected_version':state['version'],'expected_id':state['id']});self.assertEqual(code,200)
        self.assertEqual(new['id'],original['id']);self.assertEqual(new['version'],3)
        code,_=await self.request('DELETE','/api/calendar-sharing/mine/bob',query=args);self.assertEqual(code,409)

    async def test_shared_order_uses_one_timezone_and_cap_preserves_earliest(self):
        await self.enable();await self.share(share_tasks=True)
        event=await self.event()
        _,task=await self.request('POST','/api/tasks',payload={'title':'Before event','due_date':'2026-10-16','due_time':'06:00'})
        _,page=await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query)
        self.assertEqual([item['id'] for item in page['items']],[task['id'],event['id']])
        from app.db.models import Task
        async with self.sessions() as db:
            for index in range(505): db.add(Task(user_id='alice',title=f'Late {index}',due_date='2026-10-16',due_time='23:00'))
            db.add(Task(id='earliest-all-day',user_id='alice',title='First at midnight',due_date='2026-10-16'))
            await db.commit()
        _,page=await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query)
        self.assertEqual(len(page['items']),500);self.assertTrue(page['truncated']);self.assertEqual(page['items'][0]['id'],'earliest-all-day')

    async def test_assignment_versions_block_aba_and_retry_has_no_duplicate_audit(self):
        from app.db.access import AccessAuditLog
        await self.enable()
        code,_=await self.request('PUT','/api/access/users/alice/calendar-sharing',payload={'enabled':False,'expected_enabled':True,'expected_version':1});self.assertEqual(code,200)
        await self.enable()
        code,_=await self.request('PUT','/api/access/users/alice/calendar-sharing',payload={'enabled':False,'expected_enabled':True,'expected_version':1});self.assertEqual(code,409)
        code,_=await self.request('PUT','/api/access/users/alice/calendar-sharing',payload={'enabled':True,'expected_enabled':False,'expected_version':2});self.assertEqual(code,200)
        async with self.sessions() as db:
            rows=(await db.scalars(select(AccessAuditLog))).all();self.assertEqual(len(rows),3)
        _,history=await self.request('GET','/api/access/history',query={'target_id':'alice'})
        self.assertEqual(len(history['items']),3);self.assertEqual(history['items'][0]['actor_username'],'alice')

    async def test_admin_directory_filters_pagination_and_access_boundaries(self):
        from app.db.models import User
        await self.enable()
        async with self.sessions() as db:
            db.add_all([User(username=f'qa_{i:03}',email=f'qa_{i}@example.com',full_name=f'QA {i:03}',password_hash='unused') for i in range(23)])
            await db.commit()
        _,page=await self.request('GET','/api/access/accounts');self.assertEqual(len(page['items']),20);self.assertEqual(page['total'],25);self.assertTrue(page['has_more'])
        _,next_page=await self.request('GET','/api/access/accounts',query={'page':2});self.assertEqual(len(next_page['items']),5)
        self.assertFalse({row['id'] for row in page['items']} & {row['id'] for row in next_page['items']})
        _,enabled=await self.request('GET','/api/access/accounts',query={'shared':'true'});self.assertEqual([row['id'] for row in enabled['items']],['alice'])
        for path in ['/api/access/accounts','/api/access/history','/api/access/users/alice']:
            code,_=await self.request('GET',path,user='bob');self.assertEqual(code,403,path)
        code,_=await self.request('GET','/api/access/accounts',query={'q':'a'});self.assertEqual(code,422)

    async def test_audit_history_cursor_is_bounded_and_stable(self):
        from app.db.access import AccessAuditLog
        from app.db.models import User, utcnow
        async with self.sessions() as db:
            stamp=utcnow()
            db.add_all([AccessAuditLog(id=f'{i:036}',actor_id='alice',subject_id='bob',actor_name='Alice',subject_name='Bob',actor_username='alice',subject_username='bob',action='calendar_shared',changes={},created_at=stamp) for i in range(25)])
            await db.commit()
        _,first=await self.request('GET','/api/access/history');self.assertEqual(len(first['items']),20);self.assertTrue(first['next_cursor'])
        _,last=await self.request('GET','/api/access/history',query={'before':first['next_cursor']});self.assertEqual(len(last['items']),5)
        self.assertFalse({row['id'] for row in first['items']} & {row['id'] for row in last['items']})
        code,_=await self.request('GET','/api/access/history',query={'before':'garbage'});self.assertEqual(code,422)

    async def test_private_change_requires_immediate_access_recheck_and_inactive_grants_do_not_fanout(self):
        await self.enable();row=await self.share()
        async with self.sessions() as db:
            mark_changed(db,'alice','tasks');self.assertNotIn('bob',await prepare_changes(db))
            mark_changed(db,'alice','calendar-privacy');self.assertEqual((await prepare_changes(db))['bob'],{'shared-calendar','calendar-sharing','notifications'})
        await self.request('DELETE','/api/calendar-sharing/mine/bob',query={'expected_version':row['version'],'expected_id':row['id']})
        async with self.sessions() as db:
            mark_changed(db,'alice','calendar');self.assertNotIn('bob',await prepare_changes(db))

    async def test_revocation_schema_upgrade_is_repeatable(self):
        from sqlalchemy import text,inspect
        from app.db.migrations.sharing_reliability import migrate_sharing_reliability
        async with self.engine.begin() as conn:
            await conn.execute(text('ALTER TABLE calendar_shares DROP COLUMN revoked_at'))
            await migrate_sharing_reliability(conn);await migrate_sharing_reliability(conn)
            columns=await conn.run_sync(lambda c:{row['name'] for row in inspect(c).get_columns('calendar_shares')})
            self.assertIn('revoked_at',columns)


    async def test_note_title_sync_and_deletion_removes_shared_appointment(self):
        await self.enable();await self.share(share_events=True,share_notes=False)
        _,note=await self.request('POST','/api/notes',payload={'title':'Confidential note title','content':'Private body','calendar_schedule':{'starts_at':'2026-10-16T09:00:00+07:00','ends_at':'2026-10-16T09:30:00+07:00','is_all_day':False}})
        event_id=note['calendar_schedule']['event_id']
        code,updated=await self.request('PATCH',f"/api/notes/{note['id']}",payload={'expected_version':note['version'],'title':'Updated canonical note title'})
        self.assertEqual(code,200)
        _,event=await self.request('GET',f'/api/calendar/events/{event_id}');self.assertEqual(event['title'],'Updated canonical note title')
        _,page=await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query);self.assertEqual(page['total'],0)
        code,_=await self.request('DELETE',f"/api/notes/{note['id']}");self.assertEqual(code,204)
        code,_=await self.request('GET',f'/api/calendar/events/{event_id}');self.assertEqual(code,404)
        _,page=await self.request('GET','/api/calendar-sharing/view/alice',user='bob',query=self.query);self.assertEqual(page['total'],0)
        code,_=await self.request('GET',f'/api/calendar-sharing/view/alice/event/{event_id}',user='bob');self.assertEqual(code,404)

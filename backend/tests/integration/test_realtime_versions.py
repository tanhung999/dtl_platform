"""Đối soát phiên bản và thứ tự subscribe/commit, điều khiển bằng Event."""
import asyncio
import json
from tests.support.api_case import ApiTestCase
from app.core.realtime import prepare_changes, mark_changed, stream, broadcast
from app.core.workspace_versions import read_versions

class RealtimeVersionTests(ApiTestCase):
    async def test_versions_commit_atomically_and_rollback_keeps_previous_version(self):
        async with self.sessions() as db:
            mark_changed(db, 'alice', 'tasks')
            await prepare_changes(db)
            await db.commit()
        async with self.sessions() as db:
            self.assertEqual((await read_versions(db,'alice'))['tasks'],1)
            mark_changed(db,'alice','tasks');await prepare_changes(db);await db.rollback()
        async with self.sessions() as db:
            self.assertEqual((await read_versions(db,'alice'))['tasks'],1)
            self.assertEqual((await read_versions(db,'bob'))['tasks'],0)

    async def test_commit_between_subscribe_and_ready_stays_queued_with_same_version(self):
        entered, release = asyncio.Event(), asyncio.Event()
        class Connected:
            async def is_disconnected(self): return False
        async def snapshot():
            entered.set();await release.wait()
            async with self.sessions() as db:return await read_versions(db,'alice')
        messages=stream('alice',Connected(),snapshot)
        opening=asyncio.create_task(anext(messages))
        await entered.wait()
        try:
            async with self.sessions() as db:
                mark_changed(db,'alice','tasks');await prepare_changes(db);await db.commit()
                versions=await read_versions(db,'alice')
            broadcast({'user_id':'alice','topics':['tasks'],'versions':{'tasks':versions['tasks']}})
            release.set()
            ready=json.loads((await opening).removeprefix('data: '))
            change=json.loads((await anext(messages)).removeprefix('data: '))
            self.assertEqual(ready['kind'],'ready');self.assertEqual(ready['versions']['tasks'],1)
            self.assertEqual(change['versions'],{'tasks':1})
        finally:
            release.set();await messages.aclose()

    async def test_many_changes_in_one_transaction_increment_each_scope_once(self):
        async with self.sessions() as db:
            for _ in range(50): mark_changed(db,'alice','notes')
            mark_changed(db,'alice','calendar');await prepare_changes(db);await db.commit()
        async with self.sessions() as db:
            versions=await read_versions(db,'alice')
            self.assertEqual((versions['notes'],versions['calendar'],versions['tasks']),(1,1,0))

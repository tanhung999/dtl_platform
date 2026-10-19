"""Kiểm tra commit/NOTIFY bằng cổng Event trong schema PostgreSQL UUID riêng."""
import asyncio
import json
import uuid
import asyncpg
from unittest.mock import patch
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.main import app  # Đăng ký model, không khởi chạy lifespan.
from app.core.config import settings
from app.core.database import Base
from app.core.realtime import broadcast, mark_changed, prepare_changes, stream
from app.core.workspace_versions import read_versions
from app.db.models import User, Task

async def main():
    schema='realtime_qa_'+uuid.uuid4().hex
    channel=schema
    admin=create_async_engine(settings.DATABASE_URL)
    engine=create_async_engine(settings.DATABASE_URL,connect_args={'server_settings':{'search_path':schema}})
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    owner=str(uuid.uuid4());listener=None
    received=asyncio.Event()
    class Connected:
        async def is_disconnected(self):return False
    async def snapshot():
        async with sessions() as db:return await read_versions(db,owner)
    async def commit_task():
        async with sessions() as db:
            db.add(Task(user_id=owner,title='Isolated committed task'))
            mark_changed(db,owner,'tasks');await prepare_changes(db);await db.commit()
    try:
        async with admin.begin() as db:await db.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as db:await db.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add(User(id=owner,username='isolated_realtime',email='qa@example.com',full_name='QA',password_hash='unused'));await db.commit()
        listener=await asyncpg.connect(make_url(settings.DATABASE_URL).set(drivername='postgresql').render_as_string(hide_password=False))
        def notify(conn,pid,chan,payload):broadcast(json.loads(payload));received.set()
        await listener.add_listener(channel,notify)
        with patch('app.core.realtime.CHANNEL',channel):
            # A1: data read N, commit N+1, then subscribe.
            assert (await snapshot())['tasks']==0
            await commit_task();await asyncio.wait_for(received.wait(),5)
            messages=stream(owner,Connected(),snapshot)
            try:
                ready=json.loads((await anext(messages)).removeprefix('data: '));assert ready['versions']['tasks']==1
                assert ready['versions']['notes']==0
            finally:await messages.aclose()
            # A2: subscribe, block snapshot, commit, receive NOTIFY, release snapshot.
            entered,release=asyncio.Event(),asyncio.Event();received.clear()
            async def blocked_snapshot():entered.set();await release.wait();return await snapshot()
            messages=stream(owner,Connected(),blocked_snapshot);opening=asyncio.create_task(anext(messages))
            await entered.wait()
            try:
                await commit_task();await asyncio.wait_for(received.wait(),5);release.set()
                ready=json.loads((await opening).removeprefix('data: '))
                changed=json.loads((await anext(messages)).removeprefix('data: '))
                assert ready['versions']['tasks']==changed['versions']['tasks']==2
                assert changed['topics']==['tasks']
            finally:release.set();await messages.aclose()
            # Header and data must stay on the same snapshot while another write commits.
            async with sessions() as reader:
                await reader.connection(execution_options={'isolation_level':'REPEATABLE READ'})
                assert (await read_versions(reader,owner))['tasks']==2
                assert await reader.scalar(select(func.count()).select_from(Task))==2
                received.clear();await commit_task();await asyncio.wait_for(received.wait(),5)
                assert await reader.scalar(select(func.count()).select_from(Task))==2
                assert (await read_versions(reader,owner))['tasks']==2
            assert (await snapshot())['tasks']==3
            async with sessions() as db:
                mark_changed(db,owner,'tasks');await prepare_changes(db);await db.rollback()
            assert (await snapshot())['tasks']==3
        print('PASS: PostgreSQL commit-before-subscribe, commit-during-ready, real NOTIFY, consistent read snapshot, rollback, isolated schema cleanup.')
    finally:
        if listener:await listener.close()
        await engine.dispose()
        assert schema.startswith('realtime_qa_') and len(schema)==44
        async with admin.begin() as db:await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin.dispose()

if __name__=='__main__':asyncio.run(main())

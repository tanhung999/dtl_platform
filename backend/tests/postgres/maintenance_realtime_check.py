"""Kiểm tra NOTIFY theo lô và dọn dữ liệu đa worker trong schema UUID riêng."""
import asyncio
import json
import uuid
from datetime import timedelta
from unittest.mock import patch
import asyncpg
from sqlalchemy import event, select, text, func
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app  # Đăng ký metadata.
from app.core.config import settings
from app.core.database import Base
from app.core.realtime import mark_changed, prepare_changes
from app.db.models import User, Task, utcnow
from app.db.schedule_changes import ScheduleChange, ScheduleChangeReceipt
from app.db.notifications import NotificationJob
from app.modules.maintenance.cleanup import cleanup_batch


async def run():
    schema = 'maintenance_qa_' + uuid.uuid4().hex
    admin = create_async_engine(settings.DATABASE_URL)
    engine = create_async_engine(settings.DATABASE_URL, connect_args={'server_settings': {'search_path': schema}})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    listener = None; notified = set(); all_received = asyncio.Event(); notify_sql = []
    owners = [str(uuid.uuid4()) for _ in range(401)]
    def capture(conn, cursor, statement, params, context, many):
        if 'pg_notify(' in statement: notify_sql.append(statement)
    try:
        async with admin.begin() as conn: await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([User(id=owner, username='qa_' + owner, email=owner+'@example.com', full_name='QA', password_hash='unused') for owner in owners]); await db.commit()
        listener = await asyncpg.connect(make_url(settings.DATABASE_URL).set(drivername='postgresql').render_as_string(hide_password=False))
        def received(conn, pid, channel, payload):
            value = json.loads(payload)
            assert value['versions'] == {'notes': 1}
            notified.add(value['user_id'])
            if len(notified) == len(owners): all_received.set()
        await listener.add_listener(schema, received)
        event.listen(engine.sync_engine, 'before_cursor_execute', capture)
        with patch('app.core.realtime.CHANNEL', schema):
            async with sessions() as db:
                for owner in owners: mark_changed(db, owner, 'notes')
                await prepare_changes(db)
                assert not notified, 'NOTIFY must not escape before commit'
                await db.commit()
        await asyncio.wait_for(all_received.wait(), 10)
        assert notified == set(owners)
        assert len(notify_sql) == 3, len(notify_sql)
        event.remove(engine.sync_engine, 'before_cursor_execute', capture)
        now = utcnow(); owner = owners[0]
        async with sessions() as db:
            task = Task(user_id=owner, title='Maintenance QA'); db.add(task); await db.flush()
            old = ScheduleChange(owner_id=owner, request_id=str(uuid.uuid4()), fingerprint='f'*64, kind='task', resource_id=task.id,
                actor_name='QA', reason='Old', before={}, after={}, guard={}, created_at=now-timedelta(days=400)); db.add(old); await db.flush()
            db.add(ScheduleChangeReceipt(owner_id=owner, request_id=old.request_id, fingerprint=old.fingerprint, change_id=old.id))
            for i in range(3):
                db.add(NotificationJob(task_id=task.id, user_id=owner, deadline_version=0, kind='day', event_key='qa:'+str(i),
                    scheduled_at=now-timedelta(days=50), available_at=now-timedelta(days=50), processed_at=now-timedelta(days=40) if i<2 else None))
            await db.commit()
        async def clean():
            async with sessions() as db:
                result = await cleanup_batch(db, now); await db.commit(); return result
        with patch.object(settings, 'MAINTENANCE_BATCH_SIZE', 1):
            results = await asyncio.gather(clean(), clean())
        assert sorted(value['history'] for value in results) == [0, 1], results
        assert sorted(value['jobs'] for value in results) == [0, 1], results
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(ScheduleChangeReceipt)) == 1
            assert await db.scalar(select(func.count()).select_from(NotificationJob).where(NotificationJob.processed_at.is_(None))) == 1
        print('PASS: 401 committed recipients via 3 NOTIFY statements; concurrent retention claims once, bounds deletes, preserves pending jobs and receipts.')
    finally:
        if listener: await listener.close()
        await engine.dispose()
        async with admin.begin() as conn: await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin.dispose()


if __name__ == '__main__': asyncio.run(run())

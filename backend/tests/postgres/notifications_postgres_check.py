"""Opt-in PostgreSQL concurrency/rollback check in a disposable, UUID-named schema.

Run inside the backend container: PYTHONPATH=/app python tests/postgres/notifications_postgres_check.py
Never reads or writes application rows outside its own schema.
"""
import asyncio
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timezone
from unittest.mock import patch
from sqlalchemy import event, func, select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from starlette.requests import Request
from app.main import app  # Register every model, without entering the application lifespan.
from app.core.config import settings
from app.core.database import Base
from app.db.models import User, Task
from app.db.notifications import Notification, NotificationJob
from app.modules.notifications.scheduling import plan
from app.modules.notifications.worker import deliver_batch
from app.modules.notifications.integrations import receive


async def run():
    schema = 'notifications_qa_' + uuid.uuid4().hex
    admin = create_async_engine(settings.DATABASE_URL)
    engine = create_async_engine(settings.DATABASE_URL, pool_size=4,
        connect_args={'server_settings': {'search_path': schema}})
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    statements = []
    event.listen(engine.sync_engine, 'before_cursor_execute', lambda conn, cursor, statement, params, context, many: statements.append(statement))
    try:
        async with admin.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        owner = str(uuid.uuid4())
        created = datetime(2028, 1, 1, tzinfo=timezone.utc)
        before = datetime(2028, 1, 2, 1, tzinfo=timezone.utc)
        async with sessions() as db:
            db.add(User(id=owner, username='isolated_qa', email='qa@example.com', full_name='QA', password_hash='unused', allowed_apps='workflows'))
            tasks = [Task(user_id=owner, title='Batch '+str(i), due_date='2028-01-03', due_time='16:00') for i in range(80)]
            db.add_all(tasks)
            await db.flush()
            db.add_all([NotificationJob(**job) for task in tasks for job in plan(task, created)])
            await db.commit()
        async with sessions() as db:
            statements.clear()
            assert await deliver_batch(db, before) == 80
            query_count = len(statements)
            assert query_count <= 10, query_count
            await db.rollback()
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Notification)) == 0
            assert await db.scalar(select(func.count()).select_from(NotificationJob).where(NotificationJob.processed_at.is_not(None))) == 0
        async def tick():
            async with sessions() as db:
                count = await deliver_batch(db, before)
                await db.commit()
                return count
        await asyncio.gather(tick(), tick(), tick())
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Notification)) == 80
        secret = 'isolated-notification-test-secret-32-characters'
        payload = json.dumps(dict(external_id='same-message', recipient_user_id=owner, title='Concurrent ingress')).encode()
        timestamp = str(int(time.time()))
        signature = 'sha256=' + hmac.new(secret.encode(), timestamp.encode()+b'\nworkflows\n'+payload, hashlib.sha256).hexdigest()
        async def ingress():
            async def body():
                return {'type': 'http.request', 'body': payload, 'more_body': False}
            request = Request({'type': 'http', 'headers': [(b'x-notification-timestamp', timestamp.encode()), (b'x-notification-signature', signature.encode())]}, body)
            async with sessions() as db:
                value = await receive('workflows', request, db)
                await db.commit()
                return value
        with patch.object(settings, 'NOTIFICATIONS_WORKFLOWS_SECRET', secret):
            results = await asyncio.gather(*(ingress() for _ in range(20)))
        assert len({result['id'] for result in results}) == 1
        assert sum(not result['duplicate'] for result in results) == 1
        print(f'PASS: PostgreSQL rollback, 3 concurrent delivery workers, 20 concurrent signed ingestions; 80-job delivery uses {query_count} SQL statements.')
    finally:
        await engine.dispose()
        async with admin.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await admin.dispose()


if __name__ == '__main__':
    asyncio.run(run())

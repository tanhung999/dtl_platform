"""Dọn theo lô có giới hạn; không xóa job đang chờ hoặc receipt chống gửi trùng."""
import asyncio
import logging
import random
from contextlib import asynccontextmanager
from datetime import timedelta
from sqlalchemy import select, delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.core.config import settings
from app.core.database import async_session_maker
from app.db.models import utcnow
from app.db.maintenance import MaintenanceRun
from app.db.schedule_changes import ScheduleChange
from app.db.notifications import NotificationJob

log = logging.getLogger(__name__)


async def cleanup_batch(db, now=None):
    now = now or utcnow()
    insert = pg_insert if db.bind.dialect.name == 'postgresql' else sqlite_insert
    gate = insert(MaintenanceRun).values(name='retention', started_at=now)
    gate = gate.on_conflict_do_update(index_elements=['name'], set_={'started_at': now},
        where=MaintenanceRun.started_at <= now - timedelta(seconds=settings.MAINTENANCE_INTERVAL_SECONDS)).returning(MaintenanceRun.name)
    if await db.scalar(gate) is None:
        return {'history': 0, 'jobs': 0}
    removed = {}
    for model, column, days, key in [(ScheduleChange, ScheduleChange.created_at, settings.SCHEDULE_HISTORY_RETENTION_DAYS, 'history'),
                                    (NotificationJob, NotificationJob.processed_at, settings.PROCESSED_JOB_RETENTION_DAYS, 'jobs')]:
        if not days:
            removed[key] = 0
            continue
        cutoff = now - timedelta(days=days)
        candidates = select(model.id).where(column < cutoff).order_by(column, model.id).limit(settings.MAINTENANCE_BATCH_SIZE)
        if db.bind.dialect.name == 'postgresql':
            candidates = candidates.with_for_update(skip_locked=True)
        rows = (await db.execute(delete(model).where(model.id.in_(candidates), column < cutoff).returning(model.id)
                                 .execution_options(synchronize_session=False))).all()
        removed[key] = len(rows)
    return removed


@asynccontextmanager
async def run_cleanup_worker(enabled=True):
    async def loop():
        await asyncio.sleep(random.uniform(0, 10))
        while True:
            try:
                async with async_session_maker() as db:
                    removed = await cleanup_batch(db)
                    await db.commit()
                    if any(removed.values()):
                        log.info('Retention cleanup: %s', removed)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('Retention cleanup failed; retry on next interval')
            await asyncio.sleep(settings.MAINTENANCE_INTERVAL_SECONDS + random.uniform(0, 20))
    task = asyncio.create_task(loop()) if enabled else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

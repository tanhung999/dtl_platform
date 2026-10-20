"""Backfill mã chống gửi trùng trước khi bật dọn lịch sử theo thời hạn."""
from sqlalchemy import select, true
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.db.schedule_changes import ScheduleChange, ScheduleChangeReceipt
from app.db.maintenance import MaintenanceRun
from app.db.notifications import NotificationJob


async def migrate_retention(conn):
    for table in (ScheduleChangeReceipt.__table__, MaintenanceRun.__table__):
        await conn.run_sync(lambda sync, table=table: table.create(sync, checkfirst=True))
    insert = pg_insert if conn.dialect.name == 'postgresql' else sqlite_insert
    stmt = insert(ScheduleChangeReceipt).from_select(['owner_id', 'request_id', 'fingerprint', 'change_id', 'created_at'],
        select(ScheduleChange.owner_id, ScheduleChange.request_id, ScheduleChange.fingerprint, ScheduleChange.id, ScheduleChange.created_at).where(true()))
    await conn.execute(stmt.on_conflict_do_nothing(index_elements=['owner_id', 'request_id']))
    for table in (ScheduleChange.__table__, NotificationJob.__table__):
        for index in table.indexes:
            if index.name.endswith('_retention'):
                await conn.run_sync(lambda sync, index=index: index.create(sync, checkfirst=True))

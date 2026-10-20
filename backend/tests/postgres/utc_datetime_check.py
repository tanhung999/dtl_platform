"""Kiểm tra UTC với PostgreSQL; chỉ ghi bảng tạm, không sửa dữ liệu ứng dụng."""
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, Integer, MetaData, Table, select, text
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import settings
from app.db.types import UTCDateTime


async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    table = Table('utc_datetime_qa', MetaData(), Column('id', Integer, primary_key=True),
        Column('instant', UTCDateTime()), prefixes=['TEMPORARY'])
    expected = datetime(2026, 10, 21, 17, tzinfo=timezone.utc)
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                await conn.run_sync(table.create)
                for index, zone in enumerate(('Asia/Ho_Chi_Minh', 'America/Los_Angeles', 'Pacific/Kiritimati')):
                    await conn.execute(text("SELECT set_config('TimeZone', :zone, true)"), {'zone': zone})
                    value = datetime(2026, 10, 22, tzinfo=timezone(timedelta(hours=7)))
                    await conn.execute(table.insert().values(id=index, instant=value))
                    result = await conn.scalar(select(table.c.instant).where(table.c.id == index))
                    assert result == expected and result.utcoffset() == timedelta(0), (zone, result)
                    assert await conn.scalar(select(table.c.id).where(table.c.id == index, table.c.instant == value)) == index
            finally:
                await transaction.rollback()
        print('PASS: PostgreSQL UTC round-trip and query bounds across three session timezones')
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(run())

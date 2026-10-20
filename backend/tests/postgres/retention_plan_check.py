"""Đo chỉ mục dọn dữ liệu trên bảng TEMP 20.000 dòng rồi rollback."""
import asyncio
import json
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings


async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                await conn.execute(text('CREATE TEMP TABLE retention_plan_qa(id text PRIMARY KEY, processed_at timestamptz)'))
                await conn.execute(text("INSERT INTO retention_plan_qa SELECT i::text, CASE WHEN i<=100 THEN now()-interval '40 days' WHEN i<=19000 THEN now() ELSE NULL END FROM generate_series(1,20000) i"))
                await conn.execute(text('ANALYZE retention_plan_qa'))
                query = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT id FROM retention_plan_qa WHERE processed_at < now()-interval '30 days' ORDER BY processed_at,id LIMIT 500"
                before = (await conn.execute(text(query))).scalar_one()[0]
                await conn.execute(text('CREATE INDEX retention_plan_idx ON retention_plan_qa(processed_at,id) WHERE processed_at IS NOT NULL'))
                after = (await conn.execute(text(query))).scalar_one()[0]
                assert 'retention_plan_idx' in json.dumps(after)
                print(json.dumps({'rows':20000, 'before_ms':before['Execution Time'], 'after_ms':after['Execution Time'], 'uses_retention_index':True}))
            finally: await transaction.rollback()
    finally: await engine.dispose()


if __name__ == '__main__': asyncio.run(run())

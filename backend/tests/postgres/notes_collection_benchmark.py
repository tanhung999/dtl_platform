"""So sánh query cũ/mới trên TEMP table; không sửa dữ liệu người dùng."""
import asyncio
import importlib.util
import json
import statistics
import time
from types import SimpleNamespace
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from app.core.config import settings
from app.main import app  # Đăng ký đủ model khi nạp metadata.


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.note_page


async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    try:
        async with engine.connect() as conn:
            transaction = await conn.begin()
            try:
                for table in ('notes', 'calendar_events', 'note_calendar_schedules'):
                    await conn.execute(text(f'CREATE TEMP TABLE {table} (LIKE public.{table} INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES)'))
                await conn.execute(text("""INSERT INTO notes (id,user_id,title,content,color,is_pinned,is_archived,is_private,version,created_at,updated_at,search_text)
                    SELECT md5(i::text),'qa','Note '||i,repeat('Nội dung ',120),'#fef08a',i%100=0,FALSE,FALSE,0,
                    '2026-01-01'::timestamptz+i*interval '1 minute','2026-01-01'::timestamptz,'note '||i FROM generate_series(1,20000) i"""))
                await conn.execute(text("""INSERT INTO calendar_events (id,user_id,title,description,location,color,starts_at,ends_at,is_all_day,is_private,created_at,updated_at)
                    SELECT md5('e'||i),'qa','Event '||i,'','','#2563eb','2050-01-01'::timestamptz,'2050-01-02'::timestamptz,FALSE,FALSE,now(),now()
                    FROM generate_series(1,20000) i WHERE i%5=0"""))
                await conn.execute(text("INSERT INTO note_calendar_schedules SELECT md5(i::text),md5('e'||i) FROM generate_series(1,20000) i WHERE i%5=0"))
                await conn.execute(text('ANALYZE notes')); await conn.execute(text('ANALYZE note_calendar_schedules'))
                results, samples = {}, {}
                before = load('before', '/tmp/notes_collection_before.py')
                after = load('after', '/tmp/notes_collection_after.py')
                async with AsyncSession(bind=conn) as db:
                    for label, fn in [('before', before), ('after', after)]:
                        timings, captured = [], []
                        def capture(connection, cursor, statement, parameters, context, many):
                            if statement.lstrip().upper().startswith('SELECT'):
                                captured.append((statement, parameters))
                        event.listen(engine.sync_engine, 'before_cursor_execute', capture)
                        try:
                            for i in range(12):
                                captured.clear(); began = time.perf_counter()
                                value = await fn(SimpleNamespace(id='qa'), db, q='', filter='all', archived=False, widget=True, offset=0, limit=24)
                                if i >= 2: timings.append((time.perf_counter() - began) * 1000)
                            samples[label] = [{k: v for k, v in item.items()} for item in value['items']]
                        finally:
                            event.remove(engine.sync_engine, 'before_cursor_execute', capture)
                        query_count = len(captured)
                        plans = []
                        for statement, parameters in captured:
                            plan = (await conn.exec_driver_sql('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + statement, parameters)).scalar_one()
                            plans.append({'execution_ms': plan[0]['Execution Time'], 'shared_hit_blocks': plan[0]['Plan'].get('Shared Hit Blocks', 0)})
                        results[label] = {'queries': query_count, 'median_ms': round(statistics.median(timings), 3), 'plans': plans}
                    assert samples['before'] == samples['after'], 'Order, preview or schedule changed'
                print(json.dumps({'rows': 20000, 'identical_items': True, **results}))
            finally:
                if transaction.is_active: await transaction.rollback()
    finally:
        await engine.dispose()


if __name__ == '__main__':
    asyncio.run(run())

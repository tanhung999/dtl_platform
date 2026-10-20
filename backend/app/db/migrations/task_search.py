"""Bổ sung tìm kiếm công việc không dấu; điền dữ liệu theo lô, giữ nội dung gốc."""
from sqlalchemy import inspect, text
from app.core.text_search import fold_text


async def migrate_task_search(conn):
    columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('tasks')})
    if 'search_text' not in columns:
        await conn.execute(text("ALTER TABLE tasks ADD COLUMN search_text TEXT NOT NULL DEFAULT ''"))
    last = ''
    while True:
        rows = (await conn.execute(text('SELECT id, title, description FROM tasks WHERE id > :last ORDER BY id LIMIT 500'), {'last': last})).mappings().all()
        if not rows:
            break
        await conn.execute(text('UPDATE tasks SET search_text=:value WHERE id=:id'),
            [{'id': row['id'], 'value': fold_text(f"{row['title'] or ''}\n{row['description'] or ''}")} for row in rows])
        last = rows[-1]['id']
    if conn.dialect.name == 'postgresql':
        await conn.execute(text('CREATE EXTENSION IF NOT EXISTS pg_trgm'))
        await conn.execute(text('CREATE INDEX IF NOT EXISTS ix_tasks_search_trgm ON tasks USING gin (search_text gin_trgm_ops)'))

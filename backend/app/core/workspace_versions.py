"""Phiên bản nhỏ gọn để đối soát SSE; không lưu nội dung tài nguyên."""
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.db.workspace_versions import TOPICS, WorkspaceVersion as Version

def read_scopes(path):
    scopes = {
        '/api/tasks/collection': ('tasks',), '/api/tasks/calendar/page': ('tasks',),
        '/api/calendar/events/collection': ('calendar',), '/api/calendar/days': ('calendar', 'tasks'),
        '/api/notes/collection/page': ('notes', 'layout'),
        '/api/workspace/layout': ('layout',), '/api/workspace/widgets': ('widget-layout',),
        '/api/bookmarks': ('bookmarks',), '/api/notifications/summary': ('notifications',),
        '/api/access/me': ('calendar-sharing',), '/api/calendar-sharing/received': ('calendar-sharing',),
    }
    if path.startswith('/api/calendar-sharing/view/'): return ('shared-calendar', 'calendar-sharing')
    return scopes.get(path, ())

async def read_versions(db, user_id, topics=TOPICS):
    row = await db.get(Version, user_id)
    return {topic: getattr(row, topic.replace('-', '_')) if row else 0 for topic in topics}

async def advance_versions(db, changes):
    if not changes: return {}
    rows = [{'user_id': user_id, **{topic.replace('-', '_'): int(topic in changes[user_id]) for topic in TOPICS}}
            for user_id in sorted(changes)]
    insert = pg_insert if db.bind.dialect.name == 'postgresql' else sqlite_insert
    stmt = insert(Version).values(rows)
    stmt = stmt.on_conflict_do_update(index_elements=['user_id'], set_={
        topic.replace('-', '_'): getattr(Version, topic.replace('-', '_')) + getattr(stmt.excluded, topic.replace('-', '_')) for topic in TOPICS
    }).returning(*Version.__table__.columns)
    results = (await db.execute(stmt.execution_options(synchronize_session=False))).mappings().all()
    return {row['user_id']: {topic: row[topic.replace('-', '_')] for topic in TOPICS if topic in changes[row['user_id']]} for row in results}

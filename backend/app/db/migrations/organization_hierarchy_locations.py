import re
import uuid

from sqlalchemy import inspect, text

from app.db.organization import WorkLocation


def _code(value: str) -> str:
    return (re.sub(r'[^a-zA-Z0-9]+', '_', value.strip()).strip('_').upper() or 'LOCATION')[:24]


async def migrate_organization_hierarchy_locations(conn):
    await conn.run_sync(lambda sync: WorkLocation.__table__.create(sync, checkfirst=True))
    level_columns = {column['name'] for column in await conn.run_sync(lambda sync: inspect(sync).get_columns('job_levels'))}
    if 'is_management' not in level_columns:
        await conn.execute(text("ALTER TABLE job_levels ADD COLUMN is_management BOOLEAN NOT NULL DEFAULT FALSE"))
    if 'reports_to_level_id' not in level_columns:
        await conn.execute(text('ALTER TABLE job_levels ADD COLUMN reports_to_level_id VARCHAR(36)'))
    user_columns = {column['name'] for column in await conn.run_sync(lambda sync: inspect(sync).get_columns('users'))}
    if 'work_location_id' not in user_columns:
        await conn.execute(text('ALTER TABLE users ADD COLUMN work_location_id VARCHAR(36)'))

    locations = (await conn.execute(text("SELECT DISTINCT TRIM(office_location) FROM users WHERE TRIM(COALESCE(office_location,'')) <> ''"))).scalars().all()
    for name in locations:
        location_id = await conn.scalar(text('SELECT id FROM work_locations WHERE name=:name'), {'name': name})
        if not location_id:
            location_id = str(uuid.uuid4())
            await conn.execute(text('INSERT INTO work_locations(id,code,name,is_active) VALUES(:id,:code,:name,TRUE)'), {
                'id': location_id, 'code': f'{_code(name)}_{location_id[:4]}', 'name': name,
            })
        await conn.execute(text('UPDATE users SET work_location_id=:id WHERE work_location_id IS NULL AND TRIM(office_location)=:name'), {'id': location_id, 'name': name})

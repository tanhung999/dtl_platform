import re, uuid
from sqlalchemy import inspect, text
from app.db.organization import Department, Position

def code(value):
    value=re.sub(r'[^a-zA-Z0-9]+','_',value.strip()).strip('_').upper()
    return (value or 'UNSPECIFIED')[:30]

def unique_code(value, identifier):
    return f'{code(value)[:25]}_{identifier[:4]}'

async def migrate_organization_catalog(conn):
    for table in (Department.__table__,Position.__table__): await conn.run_sync(lambda sync,t=table:t.create(sync,checkfirst=True))
    columns={c['name'] for c in await conn.run_sync(lambda sync:inspect(sync).get_columns('users'))}
    if 'position_id' not in columns: await conn.execute(text('ALTER TABLE users ADD COLUMN position_id VARCHAR(36)'))
    rows=(await conn.execute(text("SELECT DISTINCT COALESCE(NULLIF(TRIM(department),''),'Chưa phân loại'), COALESCE(NULLIF(TRIM(job_title),''),'Nhân viên') FROM users"))).all()
    for department,title in rows:
        department_id=await conn.scalar(text('SELECT id FROM departments WHERE name=:name'),{'name':department})
        if not department_id:
            department_id=str(uuid.uuid4()); await conn.execute(text('INSERT INTO departments(id,code,name,is_active) VALUES(:id,:code,:name,TRUE)'),{'id':department_id,'code':unique_code(department,department_id),'name':department})
        position_id=await conn.scalar(text('SELECT id FROM positions WHERE department_id=:department AND name=:name'),{'department':department_id,'name':title})
        if not position_id:
            position_id=str(uuid.uuid4()); await conn.execute(text('INSERT INTO positions(id,code,name,department_id,is_active) VALUES(:id,:code,:name,:department,TRUE)'),{'id':position_id,'code':unique_code(title,position_id),'name':title,'department':department_id})
        await conn.execute(text("UPDATE users SET position_id=:position WHERE position_id IS NULL AND COALESCE(NULLIF(TRIM(department),''),'Chưa phân loại')=:department AND COALESCE(NULLIF(TRIM(job_title),''),'Nhân viên')=:title"),{'position':position_id,'department':department,'title':title})

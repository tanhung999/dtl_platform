import re, uuid
from sqlalchemy import inspect, text
from app.db.organization import Department, JobLevel, Position

def code(value):
    value=re.sub(r'[^a-zA-Z0-9]+','_',value.strip()).strip('_').upper()
    return (value or 'UNSPECIFIED')[:30]

def unique_code(value, identifier):
    return f'{code(value)[:25]}_{identifier[:4]}'

async def migrate_organization_catalog(conn):
    for table in (Department.__table__,JobLevel.__table__,Position.__table__): await conn.run_sync(lambda sync,t=table:t.create(sync,checkfirst=True))
    columns={c['name'] for c in await conn.run_sync(lambda sync:inspect(sync).get_columns('users'))}
    if 'position_id' not in columns: await conn.execute(text('ALTER TABLE users ADD COLUMN position_id VARCHAR(36)'))
    if 'manager_id' not in columns: await conn.execute(text('ALTER TABLE users ADD COLUMN manager_id VARCHAR(36)'))
    default_level=str(uuid.uuid4())
    if not await conn.scalar(text("SELECT id FROM job_levels WHERE code='STAFF'")):
        await conn.execute(text("INSERT INTO job_levels(id,code,name,rank,is_active) VALUES(:id,'STAFF','Nhân viên',10,TRUE)"),{'id':default_level})
    else: default_level=await conn.scalar(text("SELECT id FROM job_levels WHERE code='STAFF'"))
    rows=(await conn.execute(text("SELECT DISTINCT COALESCE(NULLIF(TRIM(department),''),'Chưa phân loại'), COALESCE(NULLIF(TRIM(job_title),''),'Nhân viên') FROM users"))).all()
    for department,title in rows:
        department_id=await conn.scalar(text('SELECT id FROM departments WHERE name=:name'),{'name':department})
        if not department_id:
            department_id=str(uuid.uuid4()); await conn.execute(text('INSERT INTO departments(id,code,name,is_active) VALUES(:id,:code,:name,TRUE)'),{'id':department_id,'code':unique_code(department,department_id),'name':department})
        position_id=await conn.scalar(text('SELECT id FROM positions WHERE department_id=:department AND name=:name AND job_level_id=:level'),{'department':department_id,'name':title,'level':default_level})
        if not position_id:
            position_id=str(uuid.uuid4()); await conn.execute(text('INSERT INTO positions(id,code,name,department_id,job_level_id,is_active) VALUES(:id,:code,:name,:department,:level,TRUE)'),{'id':position_id,'code':unique_code(title,position_id),'name':title,'department':department_id,'level':default_level})
        await conn.execute(text("UPDATE users SET position_id=:position WHERE position_id IS NULL AND COALESCE(NULLIF(TRIM(department),''),'Chưa phân loại')=:department AND COALESCE(NULLIF(TRIM(job_title),''),'Nhân viên')=:title"),{'position':position_id,'department':department,'title':title})

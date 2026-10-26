import uuid
from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, UniqueConstraint
from app.core.database import Base

class Department(Base):
    __tablename__='departments'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(120),nullable=False,unique=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class JobLevel(Base):
    __tablename__='job_levels'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(120),nullable=False,unique=True)
    rank=Column(Integer,nullable=False,default=0)
    is_management=Column(Boolean,nullable=False,default=False,server_default='false')
    reports_to_level_id=Column(String(36),ForeignKey('job_levels.id',ondelete='SET NULL'),nullable=True,index=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class WorkLocation(Base):
    __tablename__='work_locations'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(150),nullable=False,unique=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class JobLevelReportTarget(Base):
    __tablename__='job_level_report_targets'
    job_level_id=Column(String(36),ForeignKey('job_levels.id',ondelete='CASCADE'),primary_key=True)
    manager_level_id=Column(String(36),ForeignKey('job_levels.id',ondelete='CASCADE'),primary_key=True)

class Position(Base):
    __tablename__='positions'
    __table_args__=(UniqueConstraint('department_id','name','job_level_id',name='uq_position_org_mapping'),)
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(120),nullable=False)
    department_id=Column(String(36),ForeignKey('departments.id',ondelete='RESTRICT'),nullable=False,index=True)
    job_level_id=Column(String(36),ForeignKey('job_levels.id',ondelete='RESTRICT'),nullable=False,index=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

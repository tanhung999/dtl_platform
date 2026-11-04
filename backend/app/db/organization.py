import uuid
from sqlalchemy import Boolean, CheckConstraint, Column, ForeignKey, String
from app.core.database import Base

class Department(Base):
    __tablename__='departments'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(120),nullable=False,unique=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class WorkLocation(Base):
    __tablename__='work_locations'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(150),nullable=False,unique=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class Position(Base):
    __tablename__='positions'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    code=Column(String(30),nullable=False,unique=True); name=Column(String(120),nullable=False)
    department_id=Column(String(36),ForeignKey('departments.id',ondelete='RESTRICT'),nullable=False,index=True)
    is_active=Column(Boolean,nullable=False,default=True,server_default='true')

class TaskAssignmentPolicy(Base):
    __tablename__ = 'task_assignment_policies'
    __table_args__ = (CheckConstraint("mode IN ('current_department', 'selected_departments')", name='ck_task_assignment_mode'),)
    user_id = Column(String(36), ForeignKey('users.id', ondelete='CASCADE'), primary_key=True)
    enabled = Column(Boolean, nullable=False, default=True)
    mode = Column(String(30), nullable=False, default='current_department')
    home_department_id = Column(String(36), ForeignKey('departments.id', ondelete='SET NULL'), nullable=True, index=True)

class TaskAssignmentDepartment(Base):
    __tablename__ = 'task_assignment_departments'
    user_id = Column(String(36), ForeignKey('task_assignment_policies.user_id', ondelete='CASCADE'), primary_key=True)
    department_id = Column(String(36), ForeignKey('departments.id', ondelete='RESTRICT'), primary_key=True, index=True)

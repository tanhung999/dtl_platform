import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.access import AccessRole
from app.db.models import User
from app.db.organization import Department, Position, TaskAssignmentDepartment, TaskAssignmentPolicy, WorkLocation
from app.modules.access.service import MANAGE, require
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.permissions import revoke_assignment_on_department_change

router = APIRouter(prefix='/api/admin/organization', tags=['Organization administration'])
Current = Annotated[User, Depends(get_current_user)]
Db = Annotated[AsyncSession, Depends(get_db, scope='function')]
Kind = Literal['departments', 'positions', 'work-locations']


class OrgWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    department_id: str | None = None


def values(row):
    fields = ['id', 'code', 'name', 'is_active']
    if isinstance(row, Position):
        fields.append('department_id')
    return {key: getattr(row, key) for key in fields}


@router.get('')
async def catalog(actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    return {key: [values(row) for row in (await db.scalars(select(cls).order_by(cls.name, cls.id))).all()]
        for key, cls in [('departments', Department), ('positions', Position), ('work_locations', WorkLocation)]}


def model(kind):
    return {'departments': Department, 'positions': Position, 'work-locations': WorkLocation}[kind]


async def validate(db, cls, payload):
    if cls is Position:
        department = await db.get(Department, payload.department_id) if payload.department_id else None
        if not department or not department.is_active:
            raise HTTPException(422, 'Vị trí phải thuộc một phòng ban đang hoạt động.')


def write_values(cls, payload):
    data = dict(code=payload.code.strip().upper(), name=payload.name.strip(), is_active=payload.is_active)
    if not data['code'] or not data['name']:
        raise HTTPException(422, 'Vui lòng nhập mã và tên.')
    if cls is Position:
        data['department_id'] = payload.department_id
    return data


@router.post('/{kind}', status_code=201)
async def create(kind: Kind, payload: OrgWrite, actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    cls = model(kind)
    await validate(db, cls, payload)
    row = cls(id=str(uuid.uuid4()), **write_values(cls, payload))
    db.add(row)
    await db.flush()
    return values(row)


@router.put('/{kind}/{item_id}')
async def update_item(kind: Kind, item_id: str, payload: OrgWrite, actor: Current, db: Db):
    await db.scalar(select(AccessRole).where(AccessRole.id == 'access_admin').with_for_update())
    await require(db, actor.id, MANAGE)
    if not await db.scalar(select(User.id).where(User.id == actor.id, User.is_active.is_(True))):
        raise HTTPException(403, 'Tài khoản của bạn không còn hoạt động.')
    cls = model(kind)
    row = await db.scalar(select(cls).where(cls.id == item_id).with_for_update())
    if not row:
        raise HTTPException(404, 'Không tìm thấy dữ liệu tổ chức.')
    await validate(db, cls, payload)
    old_department = row.department_id if cls is Position else None
    for key, value in write_values(cls, payload).items():
        setattr(row, key, value)
    if cls is Position:
        users = (await db.scalars(select(User).where(User.position_id == row.id).order_by(User.id).with_for_update())).all()
        department = await db.get(Department, row.department_id)
        for user in users:
            if old_department != row.department_id:
                await revoke_assignment_on_department_change(db, user, actor)
            user.department = department.name
            user.job_title = row.name
            mark_changed(db, user.id, 'calendar-sharing')
    elif cls is Department:
        users = (await db.scalars(select(User).where(User.position_id.in_(
            select(Position.id).where(Position.department_id == row.id))))).all()
        for user in users:
            user.department = row.name
            mark_changed(db, user.id, 'calendar-sharing')
        scoped_users = (await db.scalars(select(TaskAssignmentDepartment.user_id).where(
            TaskAssignmentDepartment.department_id == row.id))).all()
        for user_id in scoped_users:
            mark_changed(db, user_id, 'calendar-sharing')
    else:
        await db.execute(update(User).where(User.work_location_id == row.id).values(office_location=row.name))
    mark_changed(db, actor.id, 'calendar-sharing')
    await db.flush()
    return values(row)


@router.delete('/{kind}/{item_id}', status_code=204)
async def remove(kind: Kind, item_id: str, actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    cls = model(kind)
    row = await db.get(cls, item_id)
    if not row:
        raise HTTPException(404, 'Không tìm thấy dữ liệu tổ chức.')
    if cls is Position:
        used = await db.scalar(select(func.count()).select_from(User).where(User.position_id == item_id))
    elif cls is Department:
        used = await db.scalar(select(func.count()).select_from(Position).where(Position.department_id == item_id))
        used += await db.scalar(select(func.count()).select_from(TaskAssignmentDepartment).where(TaskAssignmentDepartment.department_id == item_id))
        used += await db.scalar(select(func.count()).select_from(TaskAssignmentPolicy).where(TaskAssignmentPolicy.home_department_id == item_id))
    else:
        used = await db.scalar(select(func.count()).select_from(User).where(User.work_location_id == item_id))
    if used:
        raise HTTPException(409, 'Dữ liệu đang được sử dụng; hãy ngừng hoạt động thay vì xóa.')
    await db.delete(row)

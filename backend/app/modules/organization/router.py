import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.db.models import User
from app.db.organization import Department, JobLevel, JobLevelReportTarget, Position, WorkLocation
from app.modules.access.service import MANAGE, require
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix='/api/admin/organization', tags=['Organization administration'])
Current = Annotated[User, Depends(get_current_user)]
Db = Annotated[AsyncSession, Depends(get_db, scope='function')]
Kind = Literal['departments', 'job-levels', 'positions', 'work-locations']


class OrgWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1, max_length=150)
    is_active: bool = True
    rank: int = Field(default=100, ge=0, le=10000)
    is_management: bool = False
    reports_to_level_id: str | None = None
    report_to_level_ids: list[str] = Field(default_factory=list, max_length=100)
    department_id: str | None = None
    job_level_id: str | None = None


def values(row, report_targets: dict[str, list[str]] | None = None):
    fields = ['id', 'code', 'name', 'is_active']
    if isinstance(row, JobLevel):
        fields += ['rank', 'is_management', 'reports_to_level_id']
    elif isinstance(row, Position):
        fields += ['department_id', 'job_level_id']
    result = {key: getattr(row, key) for key in fields}
    if isinstance(row, JobLevel):
        result['report_to_level_ids'] = (report_targets or {}).get(row.id, [])
    return result


@router.get('')
async def catalog(actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    target_rows = (await db.execute(select(JobLevelReportTarget.job_level_id, JobLevelReportTarget.manager_level_id))).all()
    report_targets: dict[str, list[str]] = {}
    for level_id, manager_level_id in target_rows:
        report_targets.setdefault(level_id, []).append(manager_level_id)
    return {
        'departments': [values(x) for x in (await db.scalars(select(Department).order_by(Department.name))).all()],
        'job_levels': [values(x, report_targets) for x in (await db.scalars(select(JobLevel).order_by(JobLevel.rank, JobLevel.name))).all()],
        'positions': [values(x) for x in (await db.scalars(select(Position).order_by(Position.name))).all()],
        'work_locations': [values(x) for x in (await db.scalars(select(WorkLocation).order_by(WorkLocation.name))).all()],
    }


def model(kind: Kind):
    return {'departments': Department, 'job-levels': JobLevel, 'positions': Position, 'work-locations': WorkLocation}[kind]


async def validate_payload(db: Db, cls, payload: OrgWrite, item_id: str | None = None):
    if cls is Position:
        department = await db.get(Department, payload.department_id) if payload.department_id else None
        level = await db.get(JobLevel, payload.job_level_id) if payload.job_level_id else None
        if not department or not department.is_active or not level or not level.is_active:
            raise HTTPException(422, 'Vị trí phải thuộc phòng ban và cấp bậc đang hoạt động.')
    if cls is JobLevel:
        target_ids = list(dict.fromkeys(payload.report_to_level_ids or ([payload.reports_to_level_id] if payload.reports_to_level_id else [])))
        if item_id and item_id in target_ids:
            raise HTTPException(422, 'Cấp bậc không thể báo cáo cho chính nó.')
        parents = (await db.scalars(select(JobLevel).where(JobLevel.id.in_(target_ids)))).all() if target_ids else []
        if len(parents) != len(target_ids) or any(not parent.is_active or not parent.is_management for parent in parents):
            raise HTTPException(422, 'Tất cả cấp trên phải là cấp bậc quản lý đang hoạt động.')
        if item_id:
            frontier = set(target_ids); visited = set()
            while frontier:
                if item_id in frontier: raise HTTPException(422, 'Quan hệ cấp bậc tạo thành vòng lặp báo cáo.')
                visited.update(frontier)
                frontier = set((await db.scalars(select(JobLevelReportTarget.manager_level_id).where(JobLevelReportTarget.job_level_id.in_(frontier)))).all()) - visited


def write_values(cls, payload: OrgWrite):
    data = {'code': payload.code.strip().upper(), 'name': payload.name.strip(), 'is_active': payload.is_active}
    if cls is JobLevel:
        data.update(rank=payload.rank, is_management=payload.is_management, reports_to_level_id=payload.reports_to_level_id)
    elif cls is Position:
        data.update(department_id=payload.department_id, job_level_id=payload.job_level_id)
    return data


@router.post('/{kind}', status_code=201)
async def create(kind: Kind, payload: OrgWrite, actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    cls = model(kind)
    await validate_payload(db, cls, payload)
    row = cls(id=str(uuid.uuid4()), **write_values(cls, payload))
    db.add(row)
    await db.flush()
    target_ids = list(dict.fromkeys(payload.report_to_level_ids or ([payload.reports_to_level_id] if payload.reports_to_level_id else []))) if cls is JobLevel else []
    if cls is JobLevel:
        row.reports_to_level_id = target_ids[0] if target_ids else None
        db.add_all([JobLevelReportTarget(job_level_id=row.id, manager_level_id=target) for target in target_ids])
        await db.flush()
    return values(row, {row.id: target_ids})


@router.put('/{kind}/{item_id}')
async def update_item(kind: Kind, item_id: str, payload: OrgWrite, actor: Current, db: Db):
    await require(db, actor.id, MANAGE)
    cls = model(kind)
    row = await db.get(cls, item_id)
    if not row:
        raise HTTPException(404, 'Không tìm thấy dữ liệu tổ chức.')
    await validate_payload(db, cls, payload, item_id)
    for key, value in write_values(cls, payload).items():
        setattr(row, key, value)
    target_ids = list(dict.fromkeys(payload.report_to_level_ids or ([payload.reports_to_level_id] if payload.reports_to_level_id else []))) if cls is JobLevel else []
    if cls is JobLevel:
        await db.execute(delete(JobLevelReportTarget).where(JobLevelReportTarget.job_level_id == row.id))
        row.reports_to_level_id = target_ids[0] if target_ids else None
        db.add_all([JobLevelReportTarget(job_level_id=row.id, manager_level_id=target) for target in target_ids])
    await db.flush()
    return values(row, {row.id: target_ids})


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
    elif cls is JobLevel:
        used = await db.scalar(select(func.count()).select_from(Position).where(Position.job_level_id == item_id))
        used += await db.scalar(select(func.count()).select_from(JobLevelReportTarget).where(JobLevelReportTarget.manager_level_id == item_id))
    else:
        used = await db.scalar(select(func.count()).select_from(User).where(User.work_location_id == item_id))
    if used:
        raise HTTPException(409, 'Dữ liệu đang được sử dụng; hãy ngừng hoạt động thay vì xóa.')
    await db.delete(row)

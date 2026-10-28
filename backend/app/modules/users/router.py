"""Admin endpoints for the central user lifecycle."""

import re
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.db.access import UserRole
from app.db.models import User
from app.db.organization import Department, JobLevel, JobLevelReportTarget, Position, WorkLocation
from app.modules.access.audit import record
from app.modules.access.service import MANAGE, require
from app.modules.auth.dependencies import get_current_user
from app.modules.users.keycloak import keycloak_user_admin


router = APIRouter(prefix='/api/admin/users', tags=['User administration'])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]


def _clean_optional(value: str | None) -> str:
    return (value or '').strip()


def _validate_email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 120 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
        raise ValueError('Email không hợp lệ.')
    return value


class UserCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=3, max_length=80)
    email: str
    full_name: str = Field(min_length=2, max_length=120)
    password: str = Field(min_length=12, max_length=128)
    department: str = Field(default='', max_length=100)
    job_title: str = Field(default='', max_length=100)
    employee_code: str = Field(default='', max_length=50)
    phone: str = Field(default='', max_length=30)
    office_location: str = Field(default='', max_length=150)
    platform_admin: bool = False
    position_id: str | None = None
    manager_id: str | None = None
    work_location_id: str | None = None

    @field_validator('username')
    @classmethod
    def valid_username(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r'[a-z0-9][a-z0-9._-]*', value):
            raise ValueError('Tên đăng nhập chỉ gồm chữ thường, số, dấu chấm, gạch ngang hoặc gạch dưới.')
        return value

    @field_validator('email')
    @classmethod
    def valid_email(cls, value: str) -> str:
        return _validate_email(value)

    @field_validator('full_name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        return ' '.join(value.split())

    @field_validator('department', 'job_title', 'employee_code', 'phone', 'office_location')
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str
    full_name: str = Field(min_length=2, max_length=120)
    department: str = Field(default='', max_length=100)
    job_title: str = Field(default='', max_length=100)
    employee_code: str = Field(default='', max_length=50)
    phone: str = Field(default='', max_length=30)
    office_location: str = Field(default='', max_length=150)
    is_active: bool
    platform_admin: bool = False
    position_id: str | None = None
    manager_id: str | None = None
    work_location_id: str | None = None

    @field_validator('email')
    @classmethod
    def valid_email(cls, value: str) -> str:
        return _validate_email(value)

    @field_validator('full_name')
    @classmethod
    def clean_name(cls, value: str) -> str:
        return ' '.join(value.split())

    @field_validator('department', 'job_title', 'employee_code', 'phone', 'office_location')
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: str = Field(min_length=12, max_length=128)


class UserView(BaseModel):
    id: str
    identity_subject: str | None
    username: str
    email: str
    full_name: str
    department: str
    job_title: str
    employee_code: str
    phone: str
    office_location: str
    is_active: bool
    platform_admin: bool
    position_id: str | None
    manager_id: str | None
    work_location_id: str | None = None
    position_name: str | None = None
    job_level_name: str | None = None
    department_id: str | None = None
    job_level_id: str | None = None
    is_management: bool = False
    work_location_name: str | None = None
    created_at: datetime


def _view(user: User, platform_admin: bool, position=None, level=None, location=None) -> UserView:
    return UserView(
        **{key: getattr(user, key) for key in (
            'id', 'identity_subject', 'username', 'email', 'full_name', 'department',
            'job_title', 'employee_code', 'phone', 'office_location', 'is_active', 'created_at',
        )},
        platform_admin=platform_admin,
        position_id=user.position_id, manager_id=user.manager_id, work_location_id=user.work_location_id,
        position_name=position.name if position else None, job_level_name=level.name if level else None,
        department_id=position.department_id if position else None,
        job_level_id=position.job_level_id if position else None,
        is_management=bool(level.is_management) if level else False,
        work_location_name=location.name if location else None,
    )

async def organization_assignment(db,payload,target_id=None):
    if payload.manager_id and payload.manager_id == target_id: raise HTTPException(422,'Một tài khoản không thể tự quản lý chính mình.')
    manager=await db.scalar(select(User).where(User.id==payload.manager_id,User.is_active.is_(True))) if payload.manager_id else None
    if payload.manager_id and not manager: raise HTTPException(404,'Không tìm thấy người quản lý đang hoạt động.')
    position=await db.get(Position,payload.position_id) if payload.position_id else None
    if payload.position_id and (not position or not position.is_active): raise HTTPException(404,'Không tìm thấy vị trí đang hoạt động.')
    level=await db.get(JobLevel,position.job_level_id) if position else None
    department=await db.get(Department,position.department_id) if position else None
    location=await db.get(WorkLocation,payload.work_location_id) if payload.work_location_id else None
    if payload.work_location_id and (not location or not location.is_active): raise HTTPException(404,'Không tìm thấy vị trí làm việc đang hoạt động.')
    if manager:
        manager_position=await db.get(Position,manager.position_id) if manager.position_id else None
        manager_level=await db.get(JobLevel,manager_position.job_level_id) if manager_position else None
        if not manager_level or not manager_level.is_management:
            raise HTTPException(422,'Quản lý trực tiếp phải thuộc cấp bậc được đánh dấu là quản lý.')
        allowed_manager_levels=set((await db.scalars(select(JobLevelReportTarget.manager_level_id).where(JobLevelReportTarget.job_level_id==level.id))).all()) if level else set()
        if not allowed_manager_levels and level and level.reports_to_level_id: allowed_manager_levels={level.reports_to_level_id}
        if allowed_manager_levels and manager_level.id not in allowed_manager_levels:
            raise HTTPException(422,'Quản lý trực tiếp không đúng cấp quản lý được cấu hình.')
        if level and not allowed_manager_levels and manager_level.rank >= level.rank:
            raise HTTPException(422,'Quản lý trực tiếp phải có cấp bậc cao hơn nhân viên.')
        ancestor=manager
        seen={target_id} if target_id else set()
        while ancestor and ancestor.id not in seen:
            seen.add(ancestor.id)
            ancestor=await db.get(User,ancestor.manager_id) if ancestor.manager_id else None
        if ancestor:
            raise HTTPException(422,'Quan hệ quản lý tạo thành vòng lặp trong sơ đồ tổ chức.')
    return manager,position,level,department,location


async def _is_platform_admin(db: AsyncSession, user_id: str) -> bool:
    return bool(await db.scalar(select(UserRole.user_id).where(
        UserRole.user_id == user_id, UserRole.role_id == 'access_admin')))


@router.get('')
async def list_users(
    actor: CurrentUser,
    db: Database,
    q: str = Query('', max_length=100),
    page: int = Query(1, ge=1, le=10000),
):
    await require(db, actor.id, MANAGE)
    conditions = []
    if q.strip():
        term = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
        conditions.append(or_(
            User.full_name.ilike(term, escape='\\'), User.username.ilike(term, escape='\\'),
            User.email.ilike(term, escape='\\'), User.employee_code.ilike(term, escape='\\'),
        ))
    total = await db.scalar(select(func.count()).select_from(User).where(*conditions))
    users = (await db.scalars(select(User).where(*conditions).order_by(User.full_name, User.id)
        .offset((page - 1) * 20).limit(20))).all()
    admin_ids = set((await db.scalars(select(UserRole.user_id).where(
        UserRole.role_id == 'access_admin', UserRole.user_id.in_([item.id for item in users])
    ))).all()) if users else set()
    positions={x.id:x for x in (await db.scalars(select(Position).where(Position.id.in_([u.position_id for u in users if u.position_id])))).all()}
    levels={x.id:x for x in (await db.scalars(select(JobLevel).where(JobLevel.id.in_([p.job_level_id for p in positions.values()])))).all()}
    locations={x.id:x for x in (await db.scalars(select(WorkLocation).where(WorkLocation.id.in_([u.work_location_id for u in users if u.work_location_id])))).all()}
    return {
        'items': [_view(item, item.id in admin_ids, positions.get(item.position_id), levels.get(positions[item.position_id].job_level_id) if item.position_id in positions else None, locations.get(item.work_location_id)) for item in users],
        'total': total, 'page': page, 'has_more': page * 20 < total,
    }


@router.get('/manager-candidates')
async def manager_candidates(actor: CurrentUser, db: Database, position_id: str = Query(min_length=1), exclude_user_id: str | None = None):
    await require(db, actor.id, MANAGE)
    position = await db.get(Position, position_id)
    level = await db.get(JobLevel, position.job_level_id) if position else None
    if not position or not level:
        raise HTTPException(404, 'Không tìm thấy vị trí hoặc cấp bậc.')
    statement = (select(User, Position, JobLevel)
        .join(Position, Position.id == User.position_id)
        .join(JobLevel, JobLevel.id == Position.job_level_id)
        .where(User.is_active.is_(True), JobLevel.is_management.is_(True)))
    if exclude_user_id:
        statement = statement.where(User.id != exclude_user_id)
    allowed_manager_levels=set((await db.scalars(select(JobLevelReportTarget.manager_level_id).where(JobLevelReportTarget.job_level_id==level.id))).all())
    if not allowed_manager_levels and level.reports_to_level_id: allowed_manager_levels={level.reports_to_level_id}
    if allowed_manager_levels:
        statement = statement.where(JobLevel.id.in_(allowed_manager_levels))
    else:
        statement = statement.where(JobLevel.rank < level.rank)
    rows = (await db.execute(statement.order_by(JobLevel.rank, User.full_name))).all()
    return [{'id': user.id, 'full_name': user.full_name, 'position_name': manager_position.name,
             'job_level_name': manager_level.name, 'department_id': manager_position.department_id}
            for user, manager_position, manager_level in rows]


@router.post('', response_model=UserView, status_code=201)
async def create_user(payload: UserCreate, actor: CurrentUser, db: Database):
    await require(db, actor.id, MANAGE)
    duplicate = await db.scalar(select(User.id).where(or_(
        func.lower(User.username) == payload.username, func.lower(User.email) == payload.email,
    )))
    if duplicate:
        raise HTTPException(409, 'Tên đăng nhập hoặc email đã tồn tại trên Platform.')
    subject = await keycloak_user_admin.create_user(
        username=payload.username, email=payload.email,
        full_name=payload.full_name, password=payload.password,
    )
    try:
        manager,position,level,department,location=await organization_assignment(db,payload)
        target = User(
            identity_subject=subject,
            username=payload.username,
            email=payload.email,
            full_name=payload.full_name,
            role='Quản Trị Viên' if payload.platform_admin else 'Người dùng',
            department=department.name if department else payload.department,
            job_title=position.name if position else payload.job_title,
            position_id=position.id if position else None, manager_id=manager.id if manager else None,
            work_location_id=location.id if location else None,
            employee_code=payload.employee_code,
            phone=payload.phone,
            office_location=location.name if location else payload.office_location,
            bio='', allowed_apps='',
            password_hash=hash_password(secrets.token_urlsafe(48)),
            is_active=True,
        )
        db.add(target)
        await db.flush()
        if payload.platform_admin:
            db.add(UserRole(user_id=target.id, role_id='access_admin'))
        record(db, actor, target, 'user_created', {'platform_admin': payload.platform_admin})
        await db.flush()
    except Exception:
        await keycloak_user_admin.delete_user(subject)
        raise
    return _view(target, payload.platform_admin,position,level,location)


@router.put('/{target_id}', response_model=UserView)
async def update_user(target_id: str, payload: UserUpdate, actor: CurrentUser, db: Database):
    await require(db, actor.id, MANAGE)
    target = await db.scalar(select(User).where(User.id == target_id).with_for_update())
    if not target:
        raise HTTPException(404, 'Không tìm thấy tài khoản.')
    if target.id == actor.id and (not payload.is_active or not payload.platform_admin):
        raise HTTPException(422, 'Không thể tự khóa hoặc tự thu hồi quyền quản trị của chính mình.')
    if not target.identity_subject:
        raise HTTPException(409, 'Tài khoản chưa được liên kết với Keycloak.')
    duplicate = await db.scalar(select(User.id).where(
        User.id != target.id, func.lower(User.email) == payload.email,
    ))
    if duplicate:
        raise HTTPException(409, 'Email đã tồn tại trên Platform.')
    before = {
        'email': target.email, 'full_name': target.full_name,
        'is_active': target.is_active, 'platform_admin': await _is_platform_admin(db, target.id),
    }
    manager,position,level,department,location=await organization_assignment(db,payload,target.id)
    await keycloak_user_admin.update_user(
        target.identity_subject, email=payload.email,
        full_name=payload.full_name, enabled=payload.is_active,
    )
    for field in ('email', 'full_name', 'department', 'job_title', 'employee_code', 'phone', 'office_location', 'is_active'):
        setattr(target, field, getattr(payload, field))
    target.position_id=position.id if position else None;target.manager_id=manager.id if manager else None;target.work_location_id=location.id if location else None
    if position: target.job_title=position.name;target.department=department.name
    if location: target.office_location=location.name
    target.role = 'Quản Trị Viên' if payload.platform_admin else 'Người dùng'
    if payload.platform_admin and not before['platform_admin']:
        db.add(UserRole(user_id=target.id, role_id='access_admin'))
    elif not payload.platform_admin and before['platform_admin']:
        await db.execute(delete(UserRole).where(
            UserRole.user_id == target.id, UserRole.role_id == 'access_admin'))
    if not payload.is_active:
        from app.modules.auth.oidc import end_user_sessions
        await end_user_sessions(db, target)
    record(db, actor, target, 'user_updated', {
        'before': before,
        'after': {
            'email': payload.email, 'full_name': payload.full_name,
            'is_active': payload.is_active, 'platform_admin': payload.platform_admin,
        },
    })
    return _view(target, payload.platform_admin,position,level,location)


@router.put('/{target_id}/password', status_code=204)
async def reset_password(target_id: str, payload: PasswordReset, actor: CurrentUser, db: Database):
    await require(db, actor.id, MANAGE)
    # Serialize with account locking; a stale reset must not re-enable Keycloak.
    target = await db.scalar(select(User).where(User.id == target_id)
        .with_for_update().execution_options(populate_existing=True))
    if not target:
        raise HTTPException(404, 'Không tìm thấy tài khoản.')
    if not target.identity_subject:
        raise HTTPException(409, 'Tài khoản chưa được liên kết với Keycloak.')
    # Đồng thời hoàn thiện hồ sơ SSO cũ trước khi đặt mật khẩu. Realm yêu cầu
    # firstName/lastName nên tài khoản tên một từ trước đây có thể bị chặn đăng nhập.
    await keycloak_user_admin.update_user(
        target.identity_subject, email=target.email,
        full_name=target.full_name, enabled=target.is_active,
    )
    await keycloak_user_admin.reset_password(target.identity_subject, payload.password)
    from app.modules.auth.oidc import end_user_sessions
    await end_user_sessions(db, target)
    record(db, actor, target, 'user_password_reset', {'temporary': False})
    return Response(status_code=204)

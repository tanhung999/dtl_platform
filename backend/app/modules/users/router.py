"""Admin endpoints for the central user lifecycle."""

import re
import secrets
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.db.access import AccessRole, UserRole
from app.db.models import User
from app.db.organization import Department, Position, WorkLocation
from app.modules.access.audit import record
from app.modules.access.service import MANAGE, has_permission, permission_users, require
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
    password: str = Field(min_length=8, max_length=128)
    department: str = Field(default='', max_length=100)
    job_title: str = Field(default='', max_length=100)
    employee_code: str = Field(default='', max_length=50)
    phone: str = Field(default='', max_length=30)
    office_location: str = Field(default='', max_length=150)
    platform_admin: bool = False
    position_id: str | None = None
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
    platform_admin: bool | None = None
    position_id: str | None = None
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
    password: str = Field(min_length=8, max_length=128)


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
    work_location_id: str | None = None
    position_name: str | None = None
    department_id: str | None = None
    work_location_name: str | None = None
    created_at: datetime


def _view(user: User, platform_admin: bool, position=None, location=None) -> UserView:
    return UserView(
        **{key: getattr(user, key) for key in (
            'id', 'identity_subject', 'username', 'email', 'full_name', 'department',
            'job_title', 'employee_code', 'phone', 'office_location', 'is_active', 'created_at',
        )},
        platform_admin=platform_admin,
        position_id=user.position_id, work_location_id=user.work_location_id,
        position_name=position.name if position else None,
        department_id=position.department_id if position else None,
        work_location_name=location.name if location else None,
    )

async def organization_assignment(db, payload, target_id=None):
    existing = await db.get(User, target_id) if target_id else None
    position = await db.get(Position, payload.position_id) if payload.position_id else None
    department = await db.get(Department, position.department_id) if position else None
    if payload.position_id and (not position or not department or
        ((not position.is_active or not department.is_active) and (not existing or existing.position_id != payload.position_id))):
        raise HTTPException(422, 'Vị trí và phòng ban phải đang hoạt động.')
    location = await db.get(WorkLocation, payload.work_location_id) if payload.work_location_id else None
    if payload.work_location_id and (not location or not location.is_active and (not existing or existing.work_location_id != payload.work_location_id)):
        raise HTTPException(404, 'Không tìm thấy nơi làm việc đang hoạt động.')
    return position, department, location


async def _is_platform_admin(db: AsyncSession, user_id: str) -> bool:
    return await has_permission(db, user_id, MANAGE)


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
    admin_ids = set((await db.scalars(permission_users(MANAGE).where(
        UserRole.user_id.in_([item.id for item in users])
    ))).all()) if users else set()
    positions={x.id:x for x in (await db.scalars(select(Position).where(Position.id.in_([u.position_id for u in users if u.position_id])))).all()}
    locations={x.id:x for x in (await db.scalars(select(WorkLocation).where(WorkLocation.id.in_([u.work_location_id for u in users if u.work_location_id])))).all()}
    return {
        'items': [_view(item, item.id in admin_ids, positions.get(item.position_id), locations.get(item.work_location_id)) for item in users],
        'total': total, 'page': page, 'has_more': page * 20 < total,
    }


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
        position,department,location=await organization_assignment(db,payload)
        target = User(
            identity_subject=subject,
            username=payload.username,
            email=payload.email,
            full_name=payload.full_name,
            role='Quản Trị Viên' if payload.platform_admin else 'Người dùng',
            department=department.name if department else payload.department,
            job_title=position.name if position else payload.job_title,
            position_id=position.id if position else None,
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
    return _view(target, payload.platform_admin,position,location)


@router.put('/{target_id}', response_model=UserView)
async def update_user(target_id: str, payload: UserUpdate, actor: CurrentUser, db: Database):
    await db.scalar(select(AccessRole).where(AccessRole.id == 'access_admin').with_for_update())
    await require(db, actor.id, MANAGE)
    if not await db.scalar(select(User.id).where(User.id == actor.id, User.is_active.is_(True))):
        raise HTTPException(403, 'Tài khoản của bạn không còn hoạt động.')
    target = await db.scalar(select(User).where(User.id == target_id).with_for_update())
    if not target:
        raise HTTPException(404, 'Không tìm thấy tài khoản.')
    if target.id == actor.id and (not payload.is_active or payload.platform_admin is False):
        raise HTTPException(422, 'Không thể tự khóa hoặc tự thu hồi quyền quản trị của chính mình.')
    current_admin = await _is_platform_admin(db, target.id)
    if payload.platform_admin is not None and payload.platform_admin != current_admin:
        raise HTTPException(409, 'Hãy thay đổi quyền Platform trong mục Phân quyền.')
    payload.platform_admin = current_admin
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
    previous_position = await db.get(Position, target.position_id) if target.position_id else None
    previous_department_id = previous_position.department_id if previous_position else None
    position,department,location=await organization_assignment(db,payload,target.id)
    updates = {field: getattr(payload, field) for field in
        ('email', 'full_name', 'department', 'job_title', 'employee_code', 'phone', 'office_location', 'is_active')}
    if position:
        updates.update(job_title=position.name, department=department.name)
    if location:
        updates['office_location'] = location.name
    unchanged = all((getattr(target, field) or '') == (value or '') for field, value in updates.items())
    if unchanged and payload.platform_admin == before['platform_admin'] and (target.position_id, target.work_location_id) == (position.id if position else None, location.id if location else None):
        return _view(target, before['platform_admin'], position, location)
    await keycloak_user_admin.update_user(
        target.identity_subject, email=payload.email,
        full_name=payload.full_name, enabled=payload.is_active,
    )
    for field, value in updates.items():
        setattr(target, field, value)
    target.position_id=position.id if position else None;target.work_location_id=location.id if location else None
    if previous_department_id != (position.department_id if position else None):
        from app.modules.tasks.permissions import revoke_assignment_on_department_change
        await revoke_assignment_on_department_change(db, target, actor)
    target.role = 'Quản Trị Viên' if payload.platform_admin else 'Người dùng'
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
    return _view(target, payload.platform_admin,position,location)


@router.put('/{target_id}/password', status_code=204)
async def reset_password(target_id: str, payload: PasswordReset, actor: CurrentUser, db: Database):
    await db.scalar(select(AccessRole).where(AccessRole.id == 'access_admin').with_for_update())
    await require(db, actor.id, MANAGE)
    if not await db.scalar(select(User.id).where(User.id == actor.id, User.is_active.is_(True))):
        raise HTTPException(403, 'Tài khoản của bạn không còn hoạt động.')
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

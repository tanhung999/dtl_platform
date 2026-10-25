"""Admin endpoints for the central user lifecycle."""

import re
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import hash_password
from app.db.access import UserRole
from app.db.applications import OidcSession
from app.db.models import User
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
    password: str = Field(min_length=8, max_length=128)
    department: str = Field(default='', max_length=100)
    job_title: str = Field(default='', max_length=100)
    employee_code: str = Field(default='', max_length=50)
    phone: str = Field(default='', max_length=30)
    office_location: str = Field(default='', max_length=150)
    platform_admin: bool = False

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
    created_at: datetime


def _view(user: User, platform_admin: bool) -> UserView:
    return UserView(
        **{key: getattr(user, key) for key in (
            'id', 'identity_subject', 'username', 'email', 'full_name', 'department',
            'job_title', 'employee_code', 'phone', 'office_location', 'is_active', 'created_at',
        )},
        platform_admin=platform_admin,
    )


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
    return {
        'items': [_view(item, item.id in admin_ids) for item in users],
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
        target = User(
            identity_subject=subject,
            username=payload.username,
            email=payload.email,
            full_name=payload.full_name,
            role='Quản Trị Viên' if payload.platform_admin else 'Người dùng',
            department=payload.department,
            job_title=payload.job_title,
            employee_code=payload.employee_code,
            phone=payload.phone,
            office_location=payload.office_location,
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
    return _view(target, payload.platform_admin)


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
    await keycloak_user_admin.update_user(
        target.identity_subject, email=payload.email,
        full_name=payload.full_name, enabled=payload.is_active,
    )
    for field in ('email', 'full_name', 'department', 'job_title', 'employee_code', 'phone', 'office_location', 'is_active'):
        setattr(target, field, getattr(payload, field))
    target.role = 'Quản Trị Viên' if payload.platform_admin else 'Người dùng'
    if payload.platform_admin and not before['platform_admin']:
        db.add(UserRole(user_id=target.id, role_id='access_admin'))
    elif not payload.platform_admin and before['platform_admin']:
        await db.execute(delete(UserRole).where(
            UserRole.user_id == target.id, UserRole.role_id == 'access_admin'))
    if not payload.is_active:
        now = datetime.now(timezone.utc)
        await db.execute(update(OidcSession).where(
            OidcSession.user_id == target.id, OidcSession.revoked_at.is_(None)
        ).values(revoked_at=now))
        await keycloak_user_admin.logout_user(target.identity_subject)
    record(db, actor, target, 'user_updated', {
        'before': before,
        'after': {
            'email': payload.email, 'full_name': payload.full_name,
            'is_active': payload.is_active, 'platform_admin': payload.platform_admin,
        },
    })
    return _view(target, payload.platform_admin)


@router.put('/{target_id}/password', status_code=204)
async def reset_password(target_id: str, payload: PasswordReset, actor: CurrentUser, db: Database):
    await require(db, actor.id, MANAGE)
    target = await db.get(User, target_id)
    if not target:
        raise HTTPException(404, 'Không tìm thấy tài khoản.')
    if not target.identity_subject:
        raise HTTPException(409, 'Tài khoản chưa được liên kết với Keycloak.')
    await keycloak_user_admin.reset_password(target.identity_subject, payload.password)
    record(db, actor, target, 'user_password_reset', {'temporary': False})
    return Response(status_code=204)

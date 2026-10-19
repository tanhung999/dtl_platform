"""Phân quyền tập trung, danh sách có giới hạn và lịch sử thao tác."""
import base64
import json
from datetime import datetime, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.models import User, utcnow
from app.db.access import CalendarShare, UserRole, AccessAccountVersion, AccessAuditLog
from app.modules.auth.dependencies import get_current_user
from .audit import record
from .service import has_permission, require, MANAGE, SHARE, permission_users

router = APIRouter(prefix='/api/access', tags=['Access'])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope='function')]


def account_query():
    return select(User.id, User.full_name, User.username, User.department, User.is_active,
        User.id.in_(permission_users(SHARE)).label('can_share'),
        func.coalesce(AccessAccountVersion.version, 0).label('access_version')).outerjoin(AccessAccountVersion, AccessAccountVersion.user_id == User.id)


def search_condition(value):
    term = '%' + value.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    return or_(User.full_name.ilike(term, escape='\\'), User.username.ilike(term, escape='\\'))


@router.get('/me')
async def me(user: UserArg, db: DbArg):
    return {'can_share': await has_permission(db, user.id, SHARE), 'can_manage': await has_permission(db, user.id, MANAGE)}


@router.get('/users')
async def users(user: UserArg, db: DbArg, q: str = Query(min_length=2, max_length=100)):
    if not (await has_permission(db, user.id, MANAGE) or await has_permission(db, user.id, SHARE)):
        raise HTTPException(403, 'Bạn không có quyền tìm tài khoản để cấp quyền.')
    if len(q.strip()) < 2: raise HTTPException(422, 'Nhập ít nhất 2 ký tự để tìm tài khoản.')
    rows = (await db.execute(account_query().where(User.is_active.is_(True), search_condition(q))
        .order_by(User.full_name, User.id).limit(20))).mappings().all()
    return [dict(row) for row in rows]


@router.get('/accounts')
async def accounts(user: UserArg, db: DbArg, q: str = Query('', max_length=100), shared: bool | None = None,
                   page: int = Query(1, ge=1, le=1000)):
    await require(db, user.id, MANAGE)
    conditions = []
    if q.strip():
        if len(q.strip()) < 2: raise HTTPException(422, 'Nhập ít nhất 2 ký tự để tìm tài khoản.')
        conditions.append(search_condition(q))
    if shared is not None: conditions.append(User.id.in_(permission_users(SHARE)) == shared)
    total = await db.scalar(select(func.count()).select_from(User).where(*conditions))
    rows = (await db.execute(account_query().where(*conditions).order_by(User.full_name, User.id).offset((page-1)*20).limit(20))).mappings().all()
    return {'items': [dict(row) for row in rows], 'total': total, 'page': page, 'has_more': page*20 < total}


@router.get('/users/{target_id}')
async def account(target_id: str, user: UserArg, db: DbArg):
    await require(db, user.id, MANAGE)
    row = (await db.execute(account_query().where(User.id == target_id))).mappings().first()
    if not row: raise HTTPException(404, 'Không tìm thấy tài khoản.')
    return dict(row)


@router.get('/history')
async def history(user: UserArg, db: DbArg, target_id: str | None = Query(None, max_length=36), before: str | None = Query(None, max_length=256)):
    await require(db, user.id, MANAGE)
    statement = select(AccessAuditLog)
    if target_id: statement = statement.where(AccessAuditLog.subject_id == target_id)
    if before:
        try:
            stamp, identifier = json.loads(base64.urlsafe_b64decode(before.encode()))
            stamp = datetime.fromisoformat(stamp)
            if not stamp.tzinfo or not isinstance(identifier, str) or len(identifier) > 36: raise ValueError()
        except (ValueError, TypeError, UnicodeError): raise HTTPException(422, 'Mốc lịch sử không hợp lệ.')
        statement = statement.where(or_(AccessAuditLog.created_at < stamp, and_(AccessAuditLog.created_at == stamp, AccessAuditLog.id < identifier)))
    rows = (await db.scalars(statement.order_by(AccessAuditLog.created_at.desc(), AccessAuditLog.id.desc()).limit(21))).all()
    utc = lambda value: value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    items = [{key: getattr(row, key) for key in ('id', 'actor_name', 'actor_username', 'subject_name', 'subject_username', 'subject_id', 'action', 'changes')} | {'created_at': utc(row.created_at)} for row in rows[:20]]
    cursor = base64.urlsafe_b64encode(json.dumps([utc(rows[19].created_at).isoformat(), rows[19].id]).encode()).decode() if len(rows)>20 else None
    return {'items': items, 'next_cursor': cursor}


class Assignment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: bool
    expected_enabled: bool
    expected_version: int = Field(ge=0)


@router.put('/users/{target_id}/calendar-sharing')
async def assign(target_id: str, payload: Assignment, user: UserArg, db: DbArg):
    await require(db, user.id, MANAGE)
    target = await db.scalar(select(User).where(User.id == target_id, User.is_active.is_(True)).with_for_update())
    if not target: raise HTTPException(404, 'Không tìm thấy tài khoản đang hoạt động.')
    current = await has_permission(db, target_id, SHARE)
    state = await db.get(AccessAccountVersion, target_id)
    version = state.version if state else 0
    if version == payload.expected_version+1 and current == payload.enabled:
        return {'can_share': current, 'access_version': version}
    if version != payload.expected_version or current != payload.expected_enabled:
        raise HTTPException(409, 'Quyền vừa thay đổi. Bản mới sẽ được tải lại; hãy xem trước khi xác nhận lại.')
    if current == payload.enabled: return {'can_share': current, 'access_version': version}
    if payload.enabled:
        db.add(UserRole(user_id=target_id, role_id='calendar_sharer'))
    else:
        await db.execute(delete(UserRole).where(UserRole.user_id == target_id, UserRole.role_id == 'calendar_sharer'))
        if await has_permission(db, target_id, SHARE):
            raise HTTPException(409, 'Quyền này còn được cấp qua vai trò khác. Hãy điều chỉnh vai trò đó trước.')
        viewers = (await db.scalars(select(CalendarShare.viewer_id).where(CalendarShare.owner_id == target_id, CalendarShare.revoked_at.is_(None)))).all()
        await db.execute(update(CalendarShare).where(CalendarShare.owner_id == target_id, CalendarShare.revoked_at.is_(None))
            .values(revoked_at=utcnow(), updated_at=utcnow(), version=CalendarShare.version+1))
        for viewer in viewers:
            mark_changed(db, viewer, 'shared-calendar')
            mark_changed(db, viewer, 'calendar-sharing')
    if state is None:
        state = AccessAccountVersion(user_id=target_id, version=0)
        db.add(state)
    state.version = version+1
    record(db, user, target, 'sharing_capability_granted' if payload.enabled else 'sharing_capability_revoked',
        {'before': current, 'after': payload.enabled, 'version': state.version})
    mark_changed(db, target_id, 'calendar-sharing')
    mark_changed(db, user.id, 'calendar-sharing')
    return {'can_share': payload.enabled, 'access_version': state.version}

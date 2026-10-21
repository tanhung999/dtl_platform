"""Private, cursor-paged inbox. Read/dismiss actions never mutate business resources."""
import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.db.models import Task, User, utcnow
from app.db.notifications import Notification as N, NotificationJob as Job, NotificationPreference as Preference
from .auth import notification_user
from app.modules.tasks.deadlines import deadline_at
from .service import changed, insert_unique, select_feed, serialize, utc

router = APIRouter(prefix='/api/notifications', tags=['Notifications'])
UserArg = Annotated[User, Depends(notification_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope='function')]
Source = Literal['platform', 'bookingreports', 'workflows', 'itam']
SOURCES = ('bookingreports', 'workflows', 'itam')

def connected():
    return {source: len(getattr(settings, f'NOTIFICATIONS_{source.upper()}_SECRET')) >= 32 for source in SOURCES}

def preference_data(row):
    return {key: getattr(row, key) if row else True for key in ('task_reminders', *SOURCES)} | {'version': row.version if row else 0, 'connected': connected()}

def cursor_for(item):
    return base64.urlsafe_b64encode(json.dumps([utc(item.created_at).isoformat(), item.id]).encode()).decode()

@router.get('')
async def inbox(user: UserArg, db: DbArg, filter: Literal['all', 'unread', 'hidden'] = 'all', source: Source | None = None,
                before: str | None = Query(None, max_length=256), limit: int = Query(25, ge=1, le=50)):
    now = utcnow()
    stmt = select_feed().where(N.user_id == user.id, N.dismissed_at.is_not(None) if filter == 'hidden' else N.dismissed_at.is_(None))
    if filter == 'unread': stmt = stmt.where(N.read_at.is_(None))
    if source: stmt = stmt.where(N.source == source)
    if before:
        try:
            stamp, id = json.loads(base64.urlsafe_b64decode(before.encode()))
            stamp = datetime.fromisoformat(stamp)
            if not stamp.tzinfo or not isinstance(id, str) or len(id) > 36: raise ValueError()
        except (ValueError, TypeError, json.JSONDecodeError, UnicodeError):
            raise HTTPException(422, 'Mốc phân trang không hợp lệ.')
        stmt = stmt.where(or_(N.created_at < stamp, and_(N.created_at == stamp, N.id < id)))
    rows = (await db.execute(stmt.order_by(N.created_at.desc(), N.id.desc()).limit(limit + 1))).all()
    visible = rows[:limit]
    return {'items': [serialize(n, task, now, event, note) for n, task, event, note in visible], 'has_more': len(rows) > limit,
            'next_cursor': cursor_for(visible[-1][0]) if len(rows) > limit else None, 'server_now': now}

@router.get('/summary')
async def summary(user: UserArg, db: DbArg):
    now = utcnow()
    unread = await db.scalar(select(func.count()).select_from(N).where(N.user_id == user.id, N.read_at.is_(None), N.dismissed_at.is_(None)))
    # Rank all current task notices, including read/hidden ones: dismissing a new
    # stage must not bring an older stage back into the action banner.
    # External notices are already distinct deliveries; do not sort their entire
    # history in a window just to choose four unread previews.
    ranked = select(N.id, func.row_number().over(partition_by=N.resource_id, order_by=(N.created_at.desc(), N.id.desc())).label('rank'))
    ranked = ranked.join(Task, Task.id == N.task_id).where(N.user_id == user.id, N.resource_type == 'task', Task.is_completed.is_(False),
        Task.deadline_version == N.deadline_version, Task.due_date.is_not(None), N.due_at > now).subquery()
    actionable = or_(N.resource_type != 'task', N.reminder_version.is_not(None), N.id.in_(select(ranked.c.id).where(ranked.c.rank == 1)))
    rows = (await db.execute(select_feed().where(N.user_id == user.id, actionable, N.read_at.is_(None), N.dismissed_at.is_(None))
        .order_by(N.created_at.desc(), N.id.desc()).limit(4))).all()
    return {'unread_count': unread, 'preview': [serialize(n, task, now, event, note) for n, task, event, note in rows], 'server_now': now}

@router.get('/preferences')
async def preferences(user: UserArg, db: DbArg):
    return preference_data(await db.get(Preference, user.id))

class PreferenceWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_version: int = Field(ge=0)
    task_reminders: bool | None = None
    bookingreports: bool | None = None
    workflows: bool | None = None
    itam: bool | None = None

@router.patch('/preferences')
async def save_preferences(payload: PreferenceWrite, user: UserArg, db: DbArg):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    row = await db.get(Preference, user.id)
    if payload.expected_version != (row.version if row else 0):
        raise HTTPException(409, 'Cài đặt đã thay đổi. Hãy tải lại trước khi lưu.')
    data = payload.model_dump(exclude={'expected_version'}, exclude_unset=True)
    if any(value is None for value in data.values()):
        raise HTTPException(422, 'Cài đặt không được để trống.')
    current = preference_data(row)
    data = {key: value for key, value in data.items() if current[key] != value}
    if not data:
        return current
    if row is None:
        row = Preference(user_id=user.id, version=0)
        db.add(row)
    for key, value in data.items():
        setattr(row, key, value)
    row.version += 1
    await db.flush()
    changed(db, user.id)
    return preference_data(row)

class ReadAll(BaseModel):
    through: datetime
    @field_validator('through')
    @classmethod
    def aware(cls, value):
        if not value.tzinfo: raise ValueError('Thời gian phải kèm múi giờ.')
        return value.astimezone(timezone.utc)

@router.post('/read-all', status_code=204)
async def read_all(payload: ReadAll, user: UserArg, db: DbArg):
    now = utcnow()
    result = await db.execute(update(N).where(N.user_id == user.id, N.read_at.is_(None), N.dismissed_at.is_(None), N.created_at <= min(payload.through, now)).values(read_at=now))
    if result.rowcount:
        changed(db, user.id)

async def owned(db, user, id, lock=False):
    stmt = select(N).where(N.id == id, N.user_id == user.id)
    row = await db.scalar(stmt.with_for_update() if lock else stmt)
    if not row: raise HTTPException(404, 'Không tìm thấy thông báo.')
    return row

class NotificationWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    read: bool | None = None
    dismissed: bool | None = None

@router.patch('/{id}', status_code=204)
async def set_state(id: str, payload: NotificationWrite, user: UserArg, db: DbArg):
    row = await owned(db, user, id, lock=True)
    data = payload.model_dump(exclude_unset=True)
    if any(value is None for value in data.values()):
        raise HTTPException(422, 'Trạng thái không được để trống.')
    modified = False
    for key, value in data.items():
        field = 'read_at' if key == 'read' else 'dismissed_at'
        if (getattr(row, field) is not None) != value:
            setattr(row, field, utcnow() if value else None)
            modified = True
    if modified:
        changed(db, user.id)

@router.post('/{id}/snooze', status_code=204)
async def snooze(id: str, user: UserArg, db: DbArg):
    notice = await owned(db, user, id)
    task = await db.scalar(select(Task).where(Task.id == notice.task_id, Task.user_id == user.id).with_for_update()) if notice.task_id else None
    if not task or task.is_completed or task.deadline_version != notice.deadline_version or not task.due_date or notice.reminder_version is None or task.reminder_version != notice.reminder_version or (task.reminder_minutes is None and task.reminder_at is None):
        raise HTTPException(409, 'Công việc không còn phù hợp để nhắc lại.')
    now, due = utcnow(), deadline_at(task)
    if due <= now + timedelta(hours=1):
        raise HTTPException(409, 'Hạn còn dưới 1 giờ hoặc đã qua; không thể hoãn nhắc thêm 1 giờ.')
    notice = await owned(db, user, id, lock=True)
    if not notice.snoozed_until:
        notice.snoozed_until = now + timedelta(hours=1)
        await insert_unique(db, Job, [dict(task_id=task.id, user_id=user.id, deadline_version=task.deadline_version, kind='snooze',
            reminder_version=task.reminder_version,
            event_key=f'snooze:{notice.id}', scheduled_at=notice.snoozed_until, available_at=notice.snoozed_until)], ['event_key'])
    notice.read_at = now
    changed(db, user.id)

@router.get('/{id}/destination')
async def destination(id: str, user: UserArg, db: DbArg):
    row = await owned(db, user, id)
    if row.source == 'platform':
        if row.resource_type in ('event', 'note'):
            from app.db.calendar import CalendarEvent
            from app.db.models import Note
            event = await db.scalar(select(CalendarEvent).where(CalendarEvent.id == row.event_id, CalendarEvent.user_id == user.id))
            if not event:
                raise HTTPException(404, 'Lịch hẹn đã bị xóa.')
            if row.resource_type == 'note':
                note = await db.scalar(select(Note).where(Note.id == row.resource_id, Note.user_id == user.id))
                if not note:
                    raise HTTPException(404, 'Ghi chú đã bị xóa.')
                return {'note_id': note.id}
            return {'event_id': event.id}
        if row.resource_type == 'calendar_share':
            from app.modules.calendar_sharing.service import grant_for
            await grant_for(db, row.resource_id, user.id)
            return {'calendar_owner_id': row.resource_id}
        task = await db.get(Task, row.task_id) if row.task_id else None
        if not task or task.user_id != user.id: raise HTTPException(404, 'Công việc đã bị xóa.')
        return {'task_id': task.id}
    if row.source not in (user.allowed_apps or '').split(','):
        raise HTTPException(403, 'Bạn không còn quyền truy cập ứng dụng này.')
    return {'target_app': row.source, 'action_path': row.action_path}

"""Owner manages grants; viewers have exclusively read endpoints."""
from datetime import datetime, time, timedelta, timezone
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.realtime import mark_changed
from app.db.access import CalendarShare
from app.db.models import User, Task, Note, utcnow
from app.db.calendar import CalendarEvent as Event
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.db.notifications import Notification
from app.modules.auth.dependencies import get_current_user
from app.modules.access.service import require, SHARE, permission_users
from app.modules.notifications.service import fingerprint
from app.modules.access.audit import record
from .service import grant_for, lock_owner, flags

router = APIRouter(prefix='/api/calendar-sharing', tags=['Calendar sharing'])
UserArg = Annotated[User, Depends(get_current_user)]
DbArg = Annotated[AsyncSession, Depends(get_db, scope='function')]

class GrantWrite(BaseModel):
    model_config = ConfigDict(extra='forbid')
    share_events: bool = True
    share_tasks: bool = False
    share_notes: bool = False
    expected_version: int = Field(ge=0)
    expected_id: str | None = Field(default=None, max_length=36)
    @model_validator(mode='after')
    def scope_required(self):
        if not (self.share_events or self.share_tasks or self.share_notes): raise ValueError('Chọn ít nhất một loại mục để chia sẻ.')
        return self

def grant_data(row, name, username):
    return {'id': row.id, 'owner_id': row.owner_id, 'viewer_id': row.viewer_id, 'name': name,
            'username': username, 'version': row.version, **flags(row)}

@router.get('/mine')
async def mine(user: UserArg, db: DbArg):
    await require(db, user.id, SHARE)
    rows = (await db.execute(select(CalendarShare, User.full_name, User.username).join(User, User.id == CalendarShare.viewer_id)
        .where(CalendarShare.owner_id == user.id, CalendarShare.revoked_at.is_(None)).order_by(User.full_name).limit(200))).all()
    return [grant_data(*row) for row in rows]

@router.get('/received')
async def received(user: UserArg, db: DbArg):
    rows = (await db.execute(select(CalendarShare, User.full_name, User.username).join(User, User.id == CalendarShare.owner_id)
        .where(CalendarShare.viewer_id == user.id, CalendarShare.revoked_at.is_(None), User.is_active.is_(True), User.id.in_(permission_users(SHARE)))
        .order_by(User.full_name).limit(200))).all()
    return [grant_data(*row) for row in rows]

@router.get('/mine/{viewer_id}')
async def current_grant(viewer_id: str, user: UserArg, db: DbArg):
    await require(db, user.id, SHARE)
    viewer = await db.get(User, viewer_id)
    if not viewer or not viewer.is_active or viewer_id == user.id: raise HTTPException(404, 'Không tìm thấy tài khoản người xem.')
    row = await db.scalar(select(CalendarShare).where(CalendarShare.owner_id == user.id, CalendarShare.viewer_id == viewer_id))
    if not row:
        return {'id': None, 'version': 0, 'active': False, 'share_events': True, 'share_tasks': False, 'share_notes': False}
    return {**grant_data(row, viewer.full_name, viewer.username), 'active': row.revoked_at is None}


@router.put('/mine/{viewer_id}')
async def save(viewer_id: str, payload: GrantWrite, user: UserArg, db: DbArg):
    await lock_owner(db, user.id)
    await require(db, user.id, SHARE)
    viewer = await db.get(User, viewer_id)
    if not viewer or not viewer.is_active or viewer_id == user.id: raise HTTPException(422, 'Chọn một tài khoản khác đang hoạt động.')
    row = await db.scalar(select(CalendarShare).where(CalendarShare.owner_id == user.id, CalendarShare.viewer_id == viewer_id))
    if row and payload.expected_id and row.id != payload.expected_id: raise HTTPException(409, 'Chia sẻ đã được tạo lại. Hãy tải lại danh sách.')
    if row and row.revoked_at is None and row.version == payload.expected_version + 1 and all(getattr(row, key) == getattr(payload, key) for key in ('share_events', 'share_tasks', 'share_notes')):
        return grant_data(row, viewer.full_name, viewer.username)
    if (row.version if row else 0) != payload.expected_version: raise HTTPException(409, 'Chia sẻ vừa thay đổi. Hãy tải lại danh sách.')
    if row and row.revoked_at is None and flags(row) == {key: getattr(payload, key) for key in ('share_events', 'share_tasks', 'share_notes')}:
        return grant_data(row, viewer.full_name, viewer.username)
    was_active = row is not None and row.revoked_at is None
    before = flags(row) if was_active else None
    if not was_active:
        if (await db.scalar(select(func.count()).select_from(CalendarShare).where(CalendarShare.owner_id == user.id, CalendarShare.revoked_at.is_(None)))) >= 200:
            raise HTTPException(422, 'Tối đa 200 người xem cho mỗi lịch.')
    if not row:
        row = CalendarShare(owner_id=user.id, viewer_id=viewer_id)
        db.add(row)
    elif payload.expected_id != row.id:
        raise HTTPException(409, 'Hãy tải bản quyền chia sẻ mới trước khi lưu.')
    row.revoked_at = None
    for key in ('share_events', 'share_tasks', 'share_notes'): setattr(row, key, getattr(payload, key))
    row.version = payload.expected_version + 1
    row.updated_at = utcnow()
    record(db, user, viewer, 'calendar_scope_changed' if was_active else 'calendar_shared', {'before': before, 'after': flags(row)})
    await db.flush()
    db.add(Notification(user_id=viewer_id, source='platform', event_key=f'calendar-share:{row.id}:{row.version}',
        fingerprint=fingerprint({'share': row.id, 'version': row.version}), kind='calendar_share_updated' if was_active else 'calendar_shared',
        title=(f'{user.full_name} đã cập nhật quyền xem lịch' if was_active else f'{user.full_name} đã chia sẻ lịch với bạn')[:255], body='Bạn có thể xem các mục được cho phép trong trang Lịch. Sự kiện riêng tư luôn được ẩn.',
        resource_type='calendar_share', resource_id=user.id, occurred_at=utcnow()))
    mark_changed(db, viewer_id, 'notifications')
    mark_changed(db, viewer_id, 'shared-calendar')
    mark_changed(db, viewer_id, 'calendar-sharing')
    mark_changed(db, user.id, 'calendar-sharing')
    return grant_data(row, viewer.full_name, viewer.username)

@router.delete('/mine/{viewer_id}', status_code=204)
async def revoke(viewer_id: str, user: UserArg, db: DbArg, expected_version: int = Query(ge=0), expected_id: str = Query(min_length=36, max_length=36)):
    await lock_owner(db, user.id)
    await require(db, user.id, SHARE)
    row = await db.scalar(select(CalendarShare).where(CalendarShare.owner_id == user.id, CalendarShare.viewer_id == viewer_id))
    if row and row.revoked_at is None:
        if row.id != expected_id or row.version != expected_version: raise HTTPException(409, 'Chia sẻ vừa thay đổi. Hãy tải lại danh sách.')
        row.revoked_at = row.updated_at = utcnow()
        row.version += 1
        viewer = await db.get(User, viewer_id)
        record(db, user, viewer, 'calendar_revoked', {'before': flags(row), 'after': None})
        mark_changed(db, viewer_id, 'shared-calendar')
        mark_changed(db, viewer_id, 'calendar-sharing')
        mark_changed(db, user.id, 'calendar-sharing')
    return Response(status_code=204)

@router.get('/view/{owner_id}')
async def collection(owner_id: str, user: UserArg, db: DbArg, start: datetime, end: datetime):
    grant = await grant_for(db, owner_id, user.id)
    if start.tzinfo is None or end.tzinfo is None or end <= start or end-start > timedelta(days=93):
        raise HTTPException(422, 'Khoảng xem phải kèm múi giờ và tối đa 93 ngày.')
    from app.modules.tasks.deadlines import VN
    first, last = start.astimezone(VN).date(), end.astimezone(VN).date()
    scope = or_(Schedule.note_id.is_(None) if grant.share_events else False, Schedule.note_id.is_not(None) if grant.share_notes else False)
    conditions = (Event.user_id == owner_id, Event.is_private.is_(False), Event.starts_at < end, Event.ends_at > start, scope)
    fields = [Event.id, Event.title, Event.starts_at, Event.ends_at, Event.is_all_day, Schedule.note_id,
              Note.color.label('note_color'), func.count().over().label('_total')]
    rows = []
    if grant.share_events or grant.share_notes:
        rows = (await db.execute(select(*fields).outerjoin(Schedule, Schedule.event_id == Event.id).outerjoin(Note, Note.id == Schedule.note_id)
            .where(*conditions).order_by(Event.starts_at, Event.id).limit(500))).mappings().all()
    total_events = rows[0]['_total'] if rows else 0
    items = [{**{key: value for key, value in row.items() if key != '_total'}, 'kind': 'note' if row['note_id'] else 'event'} for row in rows]
    total_tasks = 0
    if grant.share_tasks:
        where = (Task.user_id == owner_id, Task.due_date >= first, Task.due_date < last)
        tasks = (await db.execute(select(Task.id, Task.title, Task.due_date, Task.due_time, Task.priority, Task.is_completed, func.count().over().label('_total'))
            .where(*where).order_by(Task.due_date, Task.due_time.asc().nulls_first(), Task.id).limit(500))).mappings().all()
        total_tasks = tasks[0]['_total'] if tasks else 0
        items.extend({**{key: value for key, value in row.items() if key != '_total'}, 'kind': 'task'} for row in tasks)
    # Bounded payloads, no descriptions or note bodies in the grid, no per-item queries.
    total = total_events + total_tasks
    def sort_key(row):
        stamp = row.get('starts_at')
        if stamp is None:
            stamp = datetime.combine(datetime.fromisoformat(str(row['due_date'])).date(), time.fromisoformat(row.get('due_time') or '00:00'), VN)
        elif stamp.tzinfo is None:
            stamp = stamp.replace(tzinfo=timezone.utc)
        return (stamp.timestamp(), row['id'], row['kind'])
    items.sort(key=sort_key)
    return {'items': items[:500], 'total': total, 'truncated': total > min(len(items), 500), **flags(grant)}

@router.get('/view/{owner_id}/{kind}/{item_id}')
async def detail(owner_id: str, kind: str, item_id: str, user: UserArg, db: DbArg):
    grant = await grant_for(db, owner_id, user.id)
    if kind == 'task' and grant.share_tasks:
        row = await db.scalar(select(Task).where(Task.id == item_id, Task.user_id == owner_id, Task.due_date.is_not(None)))
        if row: return {'kind': kind, 'id': row.id, 'title': row.title, 'content': row.description or '', 'due_date': row.due_date,
                        'due_time': row.due_time, 'is_completed': row.is_completed, 'priority': row.priority}
    if kind in ('event', 'note') and (grant.share_events if kind == 'event' else grant.share_notes):
        query = select(Event, Schedule.note_id).outerjoin(Schedule, Schedule.event_id == Event.id).where(Event.id == item_id,
            Event.user_id == owner_id, Event.is_private.is_(False), Schedule.note_id.is_(None) if kind == 'event' else Schedule.note_id.is_not(None))
        result = (await db.execute(query)).first()
        if result:
            event, note_id = result
            note = await db.scalar(select(Note).where(Note.id == note_id, Note.user_id == owner_id)) if note_id else None
            if note_id and not note: raise HTTPException(404, 'Không tìm thấy ghi chú.')
            return {'kind': kind, 'id': event.id, 'title': note.title if note else event.title,
                    'content': note.content if note else event.description, 'location': event.location if not note else '',
                    'color': note.color if note else None, 'starts_at': event.starts_at, 'ends_at': event.ends_at, 'is_all_day': event.is_all_day}
    raise HTTPException(404, 'Mục không tồn tại hoặc không được chia sẻ.')

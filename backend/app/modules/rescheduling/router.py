"""Đổi lịch và hoàn tác có phiên bản, lý do tùy chọn và chống gửi trùng."""
import hashlib
import json
from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.db.models import User, utcnow
from app.db.schedule_changes import ScheduleChange, ScheduleChangeReceipt
from app.modules.auth.dependencies import get_current_user
from app.modules.calendar.schemas import EventWrite
from app.core.datetime_utils import database_utc

from .service import owned, snapshot, apply, response, record_change
from app.modules.notifications.reminder_fields import ReminderFields, reminder_update

router = APIRouter(prefix='/api/schedule-changes', tags=['Rescheduling'])
Kind = Literal['task', 'event', 'note']
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]


class Move(ReminderFields):
    model_config = ConfigDict(extra='forbid')
    scope: Literal["ALL", "FOLLOWING", "THIS"] = "ALL"
    occurrence_at: datetime | None = None
    request_id: UUID
    reason: str = Field(default='', max_length=500)
    expected_version: int | None = Field(default=None, ge=0)
    expected_updated_at: datetime | None = None
    due_date: date | None = None
    due_time: str | None = Field(default=None, pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    is_all_day: bool = False
    recurrence: Literal["NONE", "DAILY", "WEEKLY"] = "NONE"

    @field_validator('reason')
    @classmethod
    def trim_reason(cls, value):
        return value.strip()

    @field_validator('expected_updated_at', 'starts_at', 'ends_at', 'occurrence_at')
    @classmethod
    def aware(cls, value):
        if value is not None:
            if value.tzinfo is None or value.utcoffset() is None:
                raise ValueError('Thời gian phải kèm múi giờ.')
            return database_utc(value)
        return value

    @model_validator(mode='after')
    def valid_range(self):
        if self.starts_at is not None and self.ends_at is not None:
            validated = EventWrite(title='Dời lịch', starts_at=self.starts_at, ends_at=self.ends_at, is_all_day=self.is_all_day, recurrence=self.recurrence)
            self.starts_at, self.ends_at = validated.starts_at, validated.ends_at
        return self


@router.get('/{kind}/{resource_id}')
async def history(kind: Kind, resource_id: str, user: CurrentUser, db: Database, limit: int = Query(20, ge=1, le=50)):
    await owned(db, user, kind, resource_id, lock=False)
    rows = (await db.scalars(select(ScheduleChange).where(ScheduleChange.owner_id == user.id, ScheduleChange.kind == kind,
        ScheduleChange.resource_id == resource_id).order_by(ScheduleChange.created_at.desc(), ScheduleChange.id.desc()).limit(limit))).all()
    return [response(row) for row in rows]


@router.post('/{kind}/{resource_id}')
async def move(kind: Kind, resource_id: str, payload: Move, user: CurrentUser, db: Database):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    row = await owned(db, user, kind, resource_id)
    fingerprint = hashlib.sha256(json.dumps({'kind': kind, 'id': resource_id, **payload.model_dump(mode='json')}, sort_keys=True).encode()).hexdigest()
    receipt = await db.get(ScheduleChangeReceipt, (user.id, str(payload.request_id)))
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise HTTPException(409, 'Mã yêu cầu đã được dùng. Hãy đóng và mở lại thao tác.')
        previous = await db.get(ScheduleChange, receipt.change_id)
        if previous is None:
            raise HTTPException(410, 'Lần đổi lịch này đã hết thời hạn lưu lịch sử. Yêu cầu cũ không được thực hiện lại.')
        return response(previous)
    before, guard = await snapshot(db, row, kind)
    if kind == 'task':
        if payload.expected_version is None or payload.starts_at is not None or payload.ends_at is not None:
            raise HTTPException(422, 'Cần ngày hạn mới và phiên bản công việc.')
        target = {'due_date': (payload.due_date.isoformat() if payload.due_date else None) if 'due_date' in payload.model_fields_set else before['due_date'],
            'due_time': payload.due_time if 'due_time' in payload.model_fields_set else before['due_time']}
        if target['due_time'] and not target['due_date']: raise HTTPException(422, 'Cần ngày đến hạn khi đặt giờ.')
    elif kind == 'note' and 'event_id' not in guard:
        if payload.expected_version is None or payload.starts_at is not None or payload.ends_at is not None or payload.reminder_minutes is not None:
            raise HTTPException(422, 'Ghi chú chưa gắn lịch chỉ hỗ trợ thông báo vào ngày giờ cụ thể.')
        target = {}
    else:
        if payload.starts_at is None or payload.ends_at is None or payload.expected_updated_at is None:
            raise HTTPException(422, 'Cần thời gian mới và phiên bản lịch.')
        target = {'starts_at': payload.starts_at.isoformat(), 'ends_at': payload.ends_at.isoformat(), 'is_all_day': payload.is_all_day, 'recurrence': payload.recurrence if 'recurrence' in payload.model_fields_set else before.get('recurrence', 'NONE')}
    expected = {'expected_version': payload.expected_version, 'expected_updated_at': payload.expected_updated_at.isoformat() if payload.expected_updated_at else None}
    target.update({key: before.get(key) for key in ('reminder_minutes', 'reminder_at')})
    target.update({key: value.isoformat() if isinstance(value, datetime) else value for key, value in reminder_update(payload).items()})
    if any(expected[key] != value for key, value in guard.items() if key.startswith('expected_')):
        raise HTTPException(409, 'Mục đã thay đổi. Hãy mở lại bản mới trước khi dời lịch.')
    if before == target:
        raise HTTPException(422, 'Hãy thay đổi ngày giờ hoặc thông báo trước khi áp dụng.')
    scoped_event = None
    if kind != 'task':
        from app.db.calendar import CalendarEvent
        from app.db.note_scheduling import NoteCalendarSchedule
        scoped_event = row if kind == 'event' else await db.scalar(select(CalendarEvent).join(NoteCalendarSchedule,
            NoteCalendarSchedule.event_id == CalendarEvent.id).where(NoteCalendarSchedule.note_id == row.id))
    if scoped_event is not None and scoped_event.recurrence == 'NONE' and payload.scope in ('THIS','FOLLOWING'):
        from app.modules.calendar.scopes import series_rule
        if not await series_rule(db,scoped_event.id,scoped_event.recurrence): raise HTTPException(422,'Mục này không thuộc chuỗi lặp.')
        if not payload.occurrence_at or database_utc(payload.occurrence_at) != database_utc(scoped_event.starts_at): raise HTTPException(409,'Lần đã chỉnh riêng vừa thay đổi. Hãy mở lại lịch.')
        if payload.scope == 'THIS':
            target['recurrence']='NONE'
            await apply(db,user,row,kind,target,guard)
            change=await record_change(db,user,kind,row,before,request_id=str(payload.request_id),fingerprint=fingerprint,reason=payload.reason)
            return response(change)
        from app.modules.calendar.scopes import move_edited_following
        family=await move_edited_following(db,scoped_event,payload.occurrence_at,target)
        change=await record_change(db,user,kind,row,before,request_id=str(payload.request_id),fingerprint=fingerprint,reason=payload.reason)
        if change is None: raise HTTPException(422,'Hãy thay đổi ngày giờ hoặc thông báo trước khi áp dụng.')
        change.guard={**change.guard,'family':family}
        await db.flush()
        return response(change)
    if payload.scope != 'ALL':
        if scoped_event is None: raise HTTPException(422, 'Mục này không có chuỗi lặp.')
        if kind == 'task': raise HTTPException(422, 'Công việc không hỗ trợ phạm vi lặp.')
        from app.db.calendar import CalendarEvent
        from app.db.note_scheduling import NoteCalendarSchedule
        from app.modules.calendar.scopes import scoped_move
        event = row if kind == 'event' else await db.scalar(select(CalendarEvent).join(NoteCalendarSchedule,
            NoteCalendarSchedule.event_id == CalendarEvent.id).where(NoteCalendarSchedule.note_id == row.id))
        metadata = await scoped_move(db, event, payload.scope, payload.occurrence_at, target)
        from uuid import uuid4
        source_current, after_guard = await snapshot(db, row, kind)
        metadata['source_current'] = source_current
        metadata['source_guard'] = after_guard
        change = ScheduleChange(id=str(uuid4()), owner_id=user.id, request_id=str(payload.request_id), fingerprint=fingerprint,
            kind=kind, resource_id=row.id, actor_name=user.full_name[:200], reason=payload.reason,
            before={**before, 'starts_at':metadata['occurrence_at'], 'ends_at':(datetime.fromisoformat(metadata['occurrence_at']) + (datetime.fromisoformat(before['ends_at']) - datetime.fromisoformat(before['starts_at']))).isoformat()},
            after=target, guard={**after_guard, 'scoped':metadata})
        db.add(change)
        await db.flush()
        db.add(ScheduleChangeReceipt(owner_id=user.id, request_id=str(payload.request_id), fingerprint=fingerprint, change_id=change.id))
        await db.flush()
        return response(change)
    if scoped_event is not None:
        from app.db.calendar import CalendarEvent
        from app.db.note_scheduling import NoteCalendarSchedule
        from app.modules.calendar.scopes import family_move
        event = row if kind == 'event' else await db.scalar(select(CalendarEvent).join(NoteCalendarSchedule,
            NoteCalendarSchedule.event_id == CalendarEvent.id).where(NoteCalendarSchedule.note_id == row.id))
        family = await family_move(db, event, target)
        if family:
            change = await record_change(db, user, kind, row, before, request_id=str(payload.request_id), fingerprint=fingerprint, reason=payload.reason)
            if change is None: raise HTTPException(422,'Hãy thay đổi ngày giờ hoặc thông báo trước khi áp dụng.')
            change.guard = {**change.guard, 'family':family}
            await db.flush()
            return response(change)
    await apply(db, user, row, kind, target, guard)
    change = await record_change(db, user, kind, row, before, request_id=str(payload.request_id), fingerprint=fingerprint, reason=payload.reason)
    return response(change)


@router.post('/records/{change_id}/undo')
async def undo(change_id: UUID, user: CurrentUser, db: Database):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    change = await db.scalar(select(ScheduleChange).where(ScheduleChange.id == str(change_id), ScheduleChange.owner_id == user.id).with_for_update())
    if change is None:
        raise HTTPException(404, 'Không tìm thấy lần dời lịch.')
    row = await owned(db, user, change.kind, change.resource_id)
    current, guard = await snapshot(db, row, change.kind)
    if change.undone_at is not None:
        return {**response(change), 'current': current, 'current_guard': guard}
    if change.guard.get('family'):
        from app.modules.calendar.scopes import undo_family
        await undo_family(db,user.id,change.guard['family'])
        change.undone_at=utcnow()
        await db.flush()
        current,guard=await snapshot(db,row,change.kind)
        return {**response(change),'current':current,'current_guard':guard}
    if change.guard.get('scoped'):
        from app.db.calendar import CalendarEvent
        from app.db.note_scheduling import NoteCalendarSchedule
        from app.modules.calendar.scopes import undo_scoped
        expected_guard = {key:value for key,value in change.guard.items() if key != 'scoped'}
        if guard != expected_guard: raise HTTPException(409, 'Mục đã được sửa tiếp. Không thể hoàn tác.')
        event = row if change.kind == 'event' else await db.scalar(select(CalendarEvent).join(NoteCalendarSchedule,
            NoteCalendarSchedule.event_id == CalendarEvent.id).where(NoteCalendarSchedule.note_id == row.id))
        await undo_scoped(db, event, change.guard['scoped'])
        change.undone_at = utcnow()
        await db.flush()
        current, guard = await snapshot(db, row, change.kind)
        return {**response(change), 'current':current, 'current_guard':guard}
    expected_after = {'reminder_minutes': None, 'reminder_at': None, **change.after}
    if current != expected_after or guard != change.guard:
        raise HTTPException(409, 'Mục đã được sửa tiếp. Không thể hoàn tác; hãy mở lại bản mới.')
    await apply(db, user, row, change.kind, {'reminder_minutes': None, 'reminder_at': None, **change.before}, guard, allow_elapsed=True)
    change.undone_at = utcnow()
    await db.flush()
    current, guard = await snapshot(db, row, change.kind)
    return {**response(change), 'current': current, 'current_guard': guard}

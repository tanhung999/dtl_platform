"""Lịch sử thay đổi lịch dùng chung, trong cùng giao dịch cập nhật."""
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import Task, Note
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.schedule_changes import ScheduleChange, ScheduleChangeReceipt
from app.core.datetime_utils import database_utc
from app.modules.tasks.schemas import TaskUpdate
from app.modules.notes.schemas import NoteUpdate
from app.modules.calendar.schemas import EventUpdate


def event_snapshot(event):
    return {'starts_at': database_utc(event.starts_at).isoformat(), 'ends_at': database_utc(event.ends_at).isoformat(), 'is_all_day': event.is_all_day}


async def record_change(db, user, kind, row, before, *, request_id=None, fingerprint=None, reason=''):
    after, guard = await snapshot(db, row, kind)
    if before == after:
        return None
    key = request_id or str(uuid4())
    digest = fingerprint or hashlib.sha256(json.dumps({'kind': kind, 'id': row.id, 'before': before, 'after': after}, sort_keys=True).encode()).hexdigest()
    change = ScheduleChange(owner_id=user.id, request_id=key, fingerprint=digest, kind=kind, resource_id=row.id,
        actor_name=user.full_name[:200], reason=reason, before=before, after=after, guard=guard)
    db.add(change)
    await db.flush()
    if request_id is not None:
        db.add(ScheduleChangeReceipt(owner_id=user.id, request_id=key, fingerprint=digest, change_id=change.id))
        await db.flush()
    return change


async def owned(db, user, kind, resource_id, *, lock=True):
    model = {'task': Task, 'event': CalendarEvent, 'note': Note}[kind]
    query = select(model).where(model.id == resource_id, model.user_id == user.id)
    row = await db.scalar(query.with_for_update() if lock else query)
    if row is None:
        raise HTTPException(404, 'Không tìm thấy mục này.')
    if kind == 'event' and row.scheduled_note_id:
        raise HTTPException(409, 'Hãy dời lịch từ ghi chú tương ứng.')
    if kind == 'note' and row.is_archived:
        raise HTTPException(422, 'Khôi phục ghi chú trước khi dời lịch.')
    return row


async def snapshot(db, row, kind):
    if kind == 'task':
        return {'due_date': row.due_date, 'due_time': row.due_time}, {'expected_version': row.version}
    if kind == 'note':
        event = await db.scalar(select(CalendarEvent).join(NoteCalendarSchedule, NoteCalendarSchedule.event_id == CalendarEvent.id)
            .where(NoteCalendarSchedule.note_id == row.id, CalendarEvent.user_id == row.user_id).with_for_update())
        if event is None:
            raise HTTPException(422, 'Ghi chú chưa gắn vào lịch.')
        guard = {'expected_version': row.version, 'expected_updated_at': database_utc(event.updated_at).isoformat(), 'event_id': event.id}
    else:
        event = row
        guard = {'expected_updated_at': database_utc(event.updated_at).isoformat()}
    return {'starts_at': database_utc(event.starts_at).isoformat(), 'ends_at': database_utc(event.ends_at).isoformat(), 'is_all_day': event.is_all_day}, guard


async def apply(db, user, row, kind, target, guard):
    if kind == 'task':
        from app.modules.tasks.service import update_task_service
        await update_task_service(row.id, TaskUpdate(**target, expected_version=guard['expected_version']), user, db, record_history=False)
    elif kind == 'note':
        from app.modules.notes.service import update_note_service
        await update_note_service(row.id, NoteUpdate(expected_version=guard['expected_version'], calendar_schedule={**target,
            'event_id': guard['event_id'], 'expected_updated_at': guard['expected_updated_at']}), user, db, record_history=False)
    else:
        from app.modules.calendar.service import update_event_service
        await update_event_service(row.id, EventUpdate(title=row.title, description=row.description, location=row.location,
            color=row.color, **target, expected_updated_at=guard['expected_updated_at']), user, db, record_history=False)


def response(row):
    return {name: getattr(row, name) for name in ('id', 'kind', 'resource_id', 'actor_name', 'reason', 'before', 'after', 'guard', 'created_at', 'undone_at')}

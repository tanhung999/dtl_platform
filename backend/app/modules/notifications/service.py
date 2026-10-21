"""Bounded inbox reads and atomic, idempotent inserts shared by internal/external producers."""
import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import load_only
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.core.realtime import mark_changed
from app.db.models import Task, Note
from app.db.calendar import CalendarEvent
from app.db.notifications import Notification

def utc(value):
    return value.replace(tzinfo=timezone.utc) if isinstance(value, datetime) and value.tzinfo is None else value

def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()

async def insert_unique(db, model, rows, keys, returning=()):
    if not rows:
        return []
    dialect = db.dialect.name if hasattr(db, 'dialect') else db.bind.dialect.name
    stmt = (pg_insert if dialect == 'postgresql' else sqlite_insert)(model).values(rows).on_conflict_do_nothing(index_elements=keys)
    result = await db.execute(stmt.returning(*returning) if returning else stmt)
    return result.all() if returning else []

def select_feed():
    # The notice supplies its saved title/body; Task is only used to derive state.
    # Raise rather than silently issuing a deferred query if a future serializer
    # starts depending on another Task column.
    return (select(Notification, Task, CalendarEvent, Note).options(load_only(
        Task.id, Task.is_completed, Task.deadline_version, Task.due_date, Task.reminder_version, raiseload=True,
    ), load_only(CalendarEvent.id, CalendarEvent.reminder_version, CalendarEvent.ends_at, raiseload=True),
        load_only(Note.id, Note.is_archived, raiseload=True)).outerjoin(Task, Task.id == Notification.task_id)
        .outerjoin(CalendarEvent, CalendarEvent.id == Notification.event_id).outerjoin(Note, (Notification.resource_type == 'note') & (Note.id == Notification.resource_id)))

def serialize(notification, task, now, event=None, note=None):
    state = 'active'
    if notification.resource_type == 'task':
        state = 'deleted' if task is None else 'completed' if task.is_completed else 'changed' if task.deadline_version != notification.deadline_version or not task.due_date else 'overdue' if notification.due_at and utc(notification.due_at) <= now else 'active'
        if task is not None and not task.is_completed and notification.reminder_version is not None and task.reminder_version != notification.reminder_version:
            state = 'changed'
    elif notification.resource_type in ('event', 'note'):
        state = 'deleted' if event is None or notification.resource_type == 'note' and note is None else 'archived' if note is not None and note.is_archived else 'changed' if event.reminder_version != notification.reminder_version else 'ended' if utc(event.ends_at) <= now else 'active'
    return {key: utc(getattr(notification, key)) for key in ('id', 'source', 'kind', 'title', 'body', 'resource_type', 'resource_id', 'due_at', 'occurred_at', 'created_at', 'read_at', 'dismissed_at', 'snoozed_until')} | {'state': state}

def changed(db, user_id):
    mark_changed(db, user_id, 'notifications')

"""Bounded inbox reads and atomic, idempotent inserts shared by internal/external producers."""
import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.orm import load_only
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.core.realtime import mark_changed
from app.db.models import Task
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
    return select(Notification, Task).options(load_only(
        Task.id, Task.is_completed, Task.deadline_version, Task.due_date, raiseload=True,
    )).outerjoin(Task, Task.id == Notification.task_id)

def serialize(notification, task, now):
    state = 'active'
    if notification.resource_type == 'task':
        state = 'deleted' if task is None else 'completed' if task.is_completed else 'changed' if task.deadline_version != notification.deadline_version or not task.due_date else 'overdue' if notification.due_at and utc(notification.due_at) <= now else 'active'
    return {key: utc(getattr(notification, key)) for key in ('id', 'source', 'kind', 'title', 'body', 'resource_type', 'resource_id', 'due_at', 'occurred_at', 'created_at', 'read_at', 'dismissed_at', 'snoozed_until')} | {'state': state}

def changed(db, user_id):
    mark_changed(db, user_id, 'notifications')

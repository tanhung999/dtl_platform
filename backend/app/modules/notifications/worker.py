"""Durable reminder delivery. Every process may run this loop; owner/resource locks avoid deadlocks."""
import asyncio
import logging
import random
from contextlib import asynccontextmanager
from datetime import datetime
from sqlalchemy import select, update, or_
from sqlalchemy.orm import load_only
from fastapi import HTTPException
from app.core.database import async_session_maker
from app.core.realtime import prepare_changes, broadcast, mark_changed
from app.db.models import Task, Note, User, utcnow
from app.db.access import CalendarShare as Grant
from app.db.calendar import CalendarEvent
from app.db.note_scheduling import NoteCalendarSchedule
from app.db.notifications import Notification, NotificationJob as Job, NotificationPreference as Preference
from app.modules.tasks.deadlines import VN, deadline_at
from .scheduling import reminder_time
from .sharing import active_grants
from .service import insert_unique, fingerprint, utc

log = logging.getLogger(__name__)

async def deliver_batch(db, now=None, limit=100):
    now = now or utcnow()
    candidates = (await db.execute(select(Job.task_id, Job.event_id, Job.note_id, Job.user_id).where(Job.processed_at.is_(None), Job.available_at <= now)
        .order_by(Job.available_at, Job.id).limit(limit))).all()
    if not candidates:
        return 0
    owners = {r.user_id for r in candidates}
    grants = (await db.scalars(active_grants().where(
        Grant.owner_id.in_(owners)))).all()
    # Lock recipients before resources too: a viewer may concurrently edit their
    # own Notes or be deleted. Include inactive owners so their queued jobs can
    # still be consumed; only active viewers are eligible for shared delivery. Never insert a delivery while waiting on its FK lock.
    recipients = owners | {g.viewer_id for g in grants}
    locked = set((await db.scalars(select(User.id).where(User.id.in_(recipients))
        .order_by(User.id).with_for_update(read=True, key_share=True, skip_locked=True))).all())
    # Share writers lock their owner. Re-read after taking those locks so newly
    # added viewers cannot be missed; retry an owner if any recipient is busy.
    grants = (await db.scalars(active_grants().where(Grant.owner_id.in_(owners))
        .execution_options(populate_existing=True))).all() if locked & owners else []
    active_viewers = set((await db.scalars(select(User.id).where(User.id.in_({g.viewer_id for g in grants}),
        User.is_active.is_(True)))).all()) if grants else set()
    user_ids = (owners & locked) - {g.owner_id for g in grants if g.viewer_id in active_viewers and g.viewer_id not in locked}
    if not user_ids:
        return 0
    task_ids = {r.task_id for r in candidates if r.task_id}
    event_ids = {r.event_id for r in candidates if r.event_id}
    note_ids = {r.note_id for r in candidates if r.note_id}
    # Lock business resources before queue rows, after the optional owner lock.
    tasks = (await db.scalars(select(Task).options(load_only(Task.id, Task.user_id, Task.title, Task.is_completed,
        Task.due_date, Task.due_time, Task.deadline_version, Task.reminder_minutes, Task.reminder_at, Task.reminder_version, Task.is_private, raiseload=True))
        .where(Task.id.in_(task_ids), Task.user_id.in_(user_ids)).order_by(Task.id).with_for_update(skip_locked=True))).all() if task_ids else []
    events = (await db.scalars(select(CalendarEvent).options(load_only(CalendarEvent.id, CalendarEvent.user_id, CalendarEvent.title,
        CalendarEvent.starts_at, CalendarEvent.ends_at, CalendarEvent.is_all_day, CalendarEvent.reminder_minutes, CalendarEvent.reminder_at,
        CalendarEvent.reminder_version, CalendarEvent.is_private, raiseload=True)).where(CalendarEvent.id.in_(event_ids), CalendarEvent.user_id.in_(user_ids)).order_by(CalendarEvent.id).with_for_update(skip_locked=True))).all() if event_ids else []
    direct_notes = (await db.scalars(select(Note).options(load_only(Note.id, Note.user_id, Note.title, Note.is_archived, Note.is_private,
        Note.reminder_at, Note.reminder_version, raiseload=True)).where(Note.id.in_(note_ids), Note.user_id.in_(user_ids))
        .order_by(Note.id).with_for_update(skip_locked=True))).all() if note_ids else []
    direct_map = {r.id:r for r in direct_notes}
    task_map, event_map = {r.id:r for r in tasks}, {r.id:r for r in events}
    if not task_map and not event_map and not direct_map:
        return 0
    jobs = (await db.scalars(select(Job).where(or_(Job.task_id.in_(task_map), Job.event_id.in_(event_map), Job.note_id.in_(direct_map)), Job.processed_at.is_(None), Job.available_at <= now)
        .order_by(Job.available_at, Job.id).limit(limit).with_for_update(skip_locked=True))).all()
    notes = (await db.execute(select(NoteCalendarSchedule.event_id, Note.id, Note.is_archived, Note.is_private)
        .join(Note, Note.id == NoteCalendarSchedule.note_id).where(NoteCalendarSchedule.event_id.in_(event_map)))).all() if event_map else []
    note_map = {r.event_id:r for r in notes}
    users = {r.user_id for r in [*tasks, *events, *direct_notes]} | active_viewers
    by_owner = {}
    for grant in grants:
        if grant.viewer_id in active_viewers:
            by_owner.setdefault(grant.owner_id, []).append(grant)
    preferences = (await db.scalars(select(Preference).where(Preference.user_id.in_(users)))).all()
    muted = {row.user_id for row in preferences if not row.task_reminders}
    rows = []
    for job in jobs:
        row = task_map.get(job.task_id) if job.task_id else direct_map.get(job.note_id) if job.note_id else event_map.get(job.event_id)
        note = direct_map.get(job.note_id) if job.note_id else note_map.get(job.event_id)
        valid = row is not None and row.user_id == job.user_id and job.reminder_version is not None and row.reminder_version == job.reminder_version
        valid = valid and (not row.is_completed if job.task_id else not note or not note.is_archived)
        if valid:
            try:
                stamp = reminder_time(row, 'task' if job.task_id else 'note' if job.note_id else 'event', now)
                valid = stamp is not None and (job.kind == 'snooze' or stamp == utc(job.scheduled_at))
            except HTTPException:
                valid = False
        if not valid:
            continue
        kind = 'task' if job.task_id else 'note' if note else 'event'
        due = deadline_at(row) if job.task_id else None if job.note_id else utc(row.starts_at)
        label = {'task':'Nhắc công việc', 'event':'Nhắc sự kiện', 'note':'Nhắc ghi chú'}[kind]
        when = utc(job.scheduled_at).astimezone(VN).strftime('%d/%m/%Y %H:%M') if due is None else (datetime.fromisoformat(row.due_date).strftime('%d/%m/%Y') + ' (cả ngày)') if job.task_id and not row.due_time else due.astimezone(VN).strftime('%d/%m/%Y' + (' (cả ngày)' if not job.task_id and row.is_all_day else ' %H:%M'))
        delivery = dict(user_id=row.user_id, calendar_owner_id=None, source='platform', event_key=job.event_key, fingerprint=fingerprint({'job':job.event_key}),
            kind=kind+'.'+('snooze' if job.kind == 'snooze' else 'reminder'), title=f'{label}: {row.title}'[:255],
            body=f'{"Nhắc lúc" if due is None else "Hạn" if kind == "task" else "Bắt đầu"} {when}', resource_type=kind, resource_id=note.id if note else row.id,
            task_id=job.task_id, event_id=job.event_id, note_id=job.note_id, deadline_version=job.deadline_version if job.task_id else None,
            reminder_version=job.reminder_version, due_at=due, occurred_at=job.scheduled_at, created_at=now)
        if row.user_id not in muted:
            rows.append(delivery)
        # Snooze is an owner's personal action, not a new reminder for viewers.
        if job.kind != 'snooze' and not job.note_id and due is not None and not row.is_private and not (note and note.is_private):
            for grant in by_owner.get(row.user_id, []):
                if getattr(grant, 'share_' + {'task':'tasks', 'event':'events', 'note':'notes'}[kind]) and grant.viewer_id not in muted:
                    rows.append({**delivery, 'user_id': grant.viewer_id, 'calendar_owner_id': row.user_id})
    inserted = await insert_unique(db, Notification, rows, ['user_id','source','event_key'], [Notification.user_id])
    if jobs:
        await db.execute(update(Job).where(Job.id.in_([j.id for j in jobs])).values(processed_at=now).execution_options(synchronize_session=False))
    for (user_id,) in inserted:
        mark_changed(db, user_id, 'notifications')
    await db.flush()
    return len(jobs)

@asynccontextmanager
async def run_worker(enabled=True):
    async def loop():
        while True:
            count = 0
            try:
                for _ in range(5):
                    async with async_session_maker() as db:
                        count = await deliver_batch(db)
                        changes = await prepare_changes(db)
                        await db.commit()
                        for user_id, topics in changes.items():
                            broadcast({'user_id': user_id, 'topics': sorted(topics)})
                    if count < 100:
                        break
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception('Notification delivery failed; pending jobs will retry')
            # Drain backlog promptly in bounded batches; idle cost stays one shared poll.
            await asyncio.sleep(.25 if count >= 100 else 15 + random.random())
    task = asyncio.create_task(loop()) if enabled else None
    try:
        yield
    finally:
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

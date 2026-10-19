"""Durable reminder delivery. Every process may run this loop; task-first locks avoid deadlocks."""
import asyncio
import logging
import random
from contextlib import asynccontextmanager
from datetime import timezone
from sqlalchemy import select, update
from app.core.database import async_session_maker
from app.core.realtime import prepare_changes, broadcast, mark_changed
from app.db.models import Task, utcnow
from app.db.notifications import Notification, NotificationJob as Job, NotificationPreference as Preference
from app.db.task_reminders import TaskReminderReceipt
from app.modules.tasks.deadlines import active_reminder, deadline_at
from .service import insert_unique, fingerprint, utc

log = logging.getLogger(__name__)

async def deliver_batch(db, now=None, limit=100):
    now = now or utcnow()
    candidates = (await db.scalars(select(Job.task_id).where(Job.processed_at.is_(None), Job.available_at <= now)
        .order_by(Job.available_at, Job.id).limit(limit))).all()
    if not candidates:
        return 0
    # Task writes lock Task then jobs; the worker follows the same order.
    tasks = (await db.scalars(select(Task).where(Task.id.in_(set(candidates))).order_by(Task.id).with_for_update(skip_locked=True))).all()
    by_id = {task.id: task for task in tasks}
    if not by_id:
        return 0
    jobs = (await db.scalars(select(Job).where(Job.task_id.in_(by_id), Job.processed_at.is_(None), Job.available_at <= now)
        .order_by(Job.available_at, Job.id).limit(limit).with_for_update(skip_locked=True))).all()
    receipts = (await db.scalars(select(TaskReminderReceipt).join(Task, (Task.id == TaskReminderReceipt.task_id) & (Task.deadline_version == TaskReminderReceipt.deadline_version)).where(TaskReminderReceipt.task_id.in_(by_id)))).all()
    receipt_map = {(row.task_id, row.deadline_version, row.kind): row for row in receipts}
    snoozes = set((await db.execute(select(Job.task_id, Job.deadline_version).where(Job.task_id.in_(by_id), Job.kind == 'snooze', Job.processed_at.is_(None), Job.available_at > now))).all())
    preferences = (await db.scalars(select(Preference).where(Preference.user_id.in_({task.user_id for task in tasks})))).all()
    muted = {row.user_id for row in preferences if not row.task_reminders}
    processed, rows = [], []
    for job in jobs:
        task = by_id[job.task_id]
        due = deadline_at(task)
        valid = not task.is_completed and due and task.deadline_version == job.deadline_version
        active = active_reminder(task, now) if valid else None
        valid = valid and ((job.kind == 'overdue' and now >= due) or (job.kind == 'snooze' and now < due) or (active and active[0] == job.kind))
        if valid and job.kind == 'overdue':
            mark_changed(db, task.user_id, 'tasks')
        if valid and job.kind in ('before', 'day'):
            receipt = receipt_map.get((task.id, task.deadline_version, job.kind))
            if receipt:
                if receipt.snoozed_until and utc(receipt.snoozed_until) > now:
                    job.available_at = utc(receipt.snoozed_until)
                    continue
                if receipt.snoozed_until is None:
                    valid = False
            if (task.id, task.deadline_version) in snoozes:
                valid = False
        processed.append(job.id)
        if not valid or task.user_id in muted:
            continue
        when = due.astimezone(timezone.utc)
        # All-day tasks expire at next midnight, but the displayed deadline is their chosen date.
        deadline = task.due_date[8:10] + '/' + task.due_date[5:7] + '/' + task.due_date[:4] + (f' {task.due_time}' if task.due_time else ' · Cả ngày')
        label = {'before': 'Sắp đến hạn', 'day': 'Đến hạn hôm nay', 'overdue': 'Đã quá hạn', 'snooze': 'Nhắc lại công việc'}[job.kind]
        rows.append(dict(user_id=task.user_id, source='platform', event_key=job.event_key, fingerprint=fingerprint({'job': job.event_key}),
            kind='task.' + job.kind, title=f'{label}: {task.title}'[:255], body=f'Hạn {deadline}', resource_type='task', resource_id=task.id,
            task_id=task.id, deadline_version=task.deadline_version, due_at=when, occurred_at=job.scheduled_at, created_at=now))
    inserted = await insert_unique(db, Notification, rows, ['user_id', 'source', 'event_key'], [Notification.user_id])
    if processed:
        await db.execute(update(Job).where(Job.id.in_(processed)).values(processed_at=now).execution_options(synchronize_session=False))
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

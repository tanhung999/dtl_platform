"""Deadline activity notices with private reminder details only for the assignee."""
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import TaskFollower, User
from app.db.notifications import TaskReminderPreference
from app.modules.collaboration_notifications import notify
from app.core.realtime import mark_changed
from .deadlines import VN
from .reminders import configured_task


def deadline_label(day, time):
    if not day:
        return 'Chưa có hạn'
    return '/'.join(reversed(day.split('-'))) + (f' lúc {time}' if time else ' · Cả ngày')


def reminder_status(task, preference, now):
    from app.modules.notifications.scheduling import reminder_time
    source = preference if preference is not None else task
    label = 'Thông báo riêng của bạn' if preference is not None else 'Thông báo của bạn'
    if source.reminder_minutes is None and source.reminder_at is None:
        return f'{label}: Không nhắc.'
    if task.is_completed:
        return f'{label} không được gửi vì công việc đã hoàn thành.'
    try:
        stamp = reminder_time(configured_task(task, source), 'task', now)
    except HTTPException:
        stamp = None
    if stamp is None or stamp <= now:
        return f'{label} không còn phù hợp với hạn mới hoặc thời điểm đã qua. Hãy mở công việc để chọn lại thời gian thông báo.'
    when = stamp.astimezone(VN).strftime('%H:%M ngày %d/%m/%Y')
    return f'{label} ' + (f'được tính lại theo hạn mới, lúc {when}.' if source.reminder_minutes is not None else f'giữ nguyên lúc {when}.')


async def notify_deadline_change(db, task, actor, before, now, *, reset_private=False):
    followers = set((await db.scalars(select(TaskFollower.user_id).where(TaskFollower.task_id == task.id))).all())
    recipients = (followers | {task.user_id, task.assignee_id}) - {actor.id}
    active = set((await db.scalars(select(User.id).where(User.id.in_(recipients), User.is_active.is_(True)))).all()) if recipients else set()
    preference = await db.get(TaskReminderPreference, (task.id, task.assignee_id)) if task.assignee_id in active else None
    body = f'{actor.full_name} đã thay đổi hạn công việc từ {deadline_label(before["due_date"], before["due_time"])} sang {deadline_label(task.due_date, task.due_time)}.'
    for recipient in active:
        personal = ''
        if recipient == task.assignee_id:
            if reset_private:
                personal = ' Thông báo riêng của bạn không còn hợp lệ với hạn mới nên đã chuyển về theo thông báo của người tạo. '
            else:
                personal = ' '
            personal += reminder_status(task, preference, now)
        notify(db, recipient, 'task_deadline_changed', f'Công việc đã thay đổi hạn: {task.title}', body + personal,
               'task', task.id, task_id=task.id, revision=str(task.version), deadline_version=task.deadline_version)
        mark_changed(db, recipient, 'notifications')

"""Directional calendar access, checked again for every inbox read and action."""
from sqlalchemy import and_, or_, select
from app.db.access import CalendarShare as Grant
from app.db.models import User, Task, Note, TaskFollower
from app.db.calendar import CalendarEvent as Event, CalendarEventFollower
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.db.notifications import Notification as N
from app.modules.access.service import SHARE, permission_users


def active_grants():
    return select(Grant).join(User, User.id == Grant.owner_id).where(
        Grant.revoked_at.is_(None), User.is_active.is_(True), User.id.in_(permission_users(SHARE)))


def visible_notice():
    # Correlate explicitly: this predicate also runs in feeds that already join Task/Event/Note.
    task = select(Task.id).where(Task.id == N.task_id, Task.user_id == Grant.owner_id,
        Task.is_private.is_(False), Task.due_date.is_not(None)).correlate(N, Grant).exists()
    event = select(Event.id).where(Event.id == N.event_id, Event.user_id == Grant.owner_id,
        Event.is_private.is_(False), ~select(Schedule.note_id).where(Schedule.event_id == Event.id).exists()
        ).correlate(N, Grant).exists()
    note = select(Note.id).join(Schedule, Schedule.note_id == Note.id).join(Event, Event.id == Schedule.event_id).where(
        Note.id == N.resource_id, Event.id == N.event_id, Note.user_id == Grant.owner_id, Event.user_id == Grant.owner_id,
        Note.is_private.is_(False), Event.is_private.is_(False), Note.is_archived.is_(False)).correlate(N, Grant).exists()
    scope = or_(and_(N.resource_type == 'task', Grant.share_tasks.is_(True), task),
        and_(N.resource_type == 'event', Grant.share_events.is_(True), event),
        and_(N.resource_type == 'note', Grant.share_notes.is_(True), note))
    grant = active_grants().where(Grant.owner_id == N.calendar_owner_id, Grant.viewer_id == N.user_id, scope).correlate(N).exists()
    followed_task = select(Task.id).where(Task.id == N.task_id, or_(Task.user_id == N.user_id, Task.assignee_id == N.user_id,
        select(TaskFollower.task_id).where(TaskFollower.task_id == Task.id, TaskFollower.user_id == N.user_id).correlate(Task, N).exists())).correlate(N).exists()
    followed_event = select(Event.id).where(Event.id == N.event_id, or_(Event.user_id == N.user_id,
        select(CalendarEventFollower.event_id).where(CalendarEventFollower.event_id == Event.id, CalendarEventFollower.user_id == N.user_id).correlate(Event, N).exists())).correlate(N).exists()
    personal = and_(N.calendar_owner_id.is_(None), or_(
        N.kind.notin_(('task.follow_reminder', 'event.follow_reminder')),
        and_(N.kind == 'task.follow_reminder', followed_task), and_(N.kind == 'event.follow_reminder', followed_event)))
    return or_(personal, and_(N.source == 'platform', grant))


async def ownership_labels(db, viewer_id):
    rows = (await db.execute(active_grants().with_only_columns(Grant.owner_id, User.job_title, User.full_name)
        .where(Grant.viewer_id == viewer_id))).all()
    return {owner: (title or '').strip() or name for owner, title, name in rows}

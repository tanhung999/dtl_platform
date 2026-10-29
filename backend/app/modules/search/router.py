"""Authenticated, bounded server search over the current user's workspace."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, func, and_, or_, case
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.text_search import fold_text
from app.core.datetime_utils import utc_mapping
from app.db.models import User, Task, Note
from app.db.calendar import CalendarEvent as Event
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.queries import task_order
from app.modules.applications.service import listed_applications_query
from app.modules.applications.router import ApplicationView
from app.modules.tasks.access import visible_tasks
from app.modules.calendar.access import visible_events
from app.modules.calendar_sharing.service import shared_owner_ids

router = APIRouter(prefix="/api/search", tags=["Workspace search"])
@router.get("")
async def search(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")], response: Response,
    q: str = Query('', max_length=200),
    kind: Literal['all', 'apps', 'tasks', 'notes', 'events'] = 'all',
    offset: int = Query(0, ge=0, le=100000), limit: int = Query(5, ge=1, le=50),
):
    response.headers['Cache-Control'] = 'no-store'
    keyword = fold_text(q)
    groups = {name: {"items": [], "total": 0} for name in ('apps', 'tasks', 'notes', 'events')}
    if len(keyword) < 2:
        return {"groups": groups, "offset": offset, "limit": limit}
    if kind in ('all', 'apps'):
        registered = (await db.scalars(listed_applications_query())).all()
        apps = [
            {"id": app.key, "title": app.display_name, "preview": app.description,
             "application": ApplicationView.model_validate(app).model_dump()}
            for app in registered
            if keyword in fold_text(app.display_name + ' ' + app.description)
        ]
        if kind == 'apps':
            offset = min(offset, ((len(apps) - 1) // limit) * limit) if apps else 0
        groups['apps'] = {"items": apps[offset:offset + limit], "total": len(apps)}
    task_direct = visible_tasks(user.id)
    event_direct = visible_events(user.id)
    note_direct = Note.user_id == user.id
    task_shared = and_(Task.user_id.in_(shared_owner_ids(user.id, 'share_tasks')),
                       Task.is_private.is_(False), Task.due_date.is_not(None))
    event_shared = and_(Event.user_id.in_(shared_owner_ids(user.id, 'share_events')), Event.is_private.is_(False))
    note_shared = and_(Note.user_id.in_(shared_owner_ids(user.id, 'share_notes')), Note.is_private.is_(False),
                      Event.user_id == Note.user_id, Event.is_private.is_(False))
    def access_fields(model, direct):
        return [model.user_id.label('owner_id'), User.full_name.label('owner_name'),
                case((direct, False), else_=True).label('shared_only')]
    specs = {
        'tasks': (Task, [Task.id, Task.title, func.substr(Task.description, 1, 240).label('preview'), Task.due_date, Task.due_time, Task.is_completed],
                  [or_(task_direct, task_shared), Task.search_text.contains(keyword, autoescape=True)], task_order(db)),
        'notes': (Note, [Note.id, Note.title, func.substr(Note.content, 1, 240).label('preview'), Note.is_pinned],
                  [or_(note_direct, note_shared), Note.is_archived.is_(False), Note.search_text.contains(keyword, autoescape=True)],
                  (Note.is_pinned.desc(), Note.created_at.desc(), Note.id)),
        'events': (Event, [Event.id, Event.title, func.substr(Event.description, 1, 240).label('preview'), Event.starts_at, Event.ends_at, Event.location, Event.is_all_day],
                   [or_(event_direct, event_shared), Event.search_text.contains(keyword, autoescape=True),
                    ~select(Schedule.note_id).where(Schedule.event_id == Event.id).exists()],
                   (Event.starts_at.desc(), Event.id)),
    }
    for name, (model, fields, conditions, order) in specs.items():
        if kind not in ('all', name):
            continue
        direct = {'tasks': task_direct, 'events': event_direct, 'notes': note_direct}[name]
        fields = [*fields, *access_fields(model, direct)]
        base = select(*fields).select_from(model).join(User, User.id == model.user_id)
        if name == 'notes':
            base = base.add_columns(Schedule.event_id.label('item_id')).outerjoin(Schedule, Schedule.note_id == Note.id).outerjoin(Event, Event.id == Schedule.event_id)
        base = base.where(*conditions)
        total = await db.scalar(select(func.count()).select_from(base.subquery()))
        if kind != 'all':
            offset = min(offset, ((total - 1) // limit) * limit) if total else 0
        rows = (await db.execute(base.order_by(*order).offset(offset).limit(limit))).mappings().all() if total else []
        groups[name] = {"items": [utc_mapping(row) for row in rows], "total": total}
    return {"groups": groups, "offset": offset, "limit": limit}

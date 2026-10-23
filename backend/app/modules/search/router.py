"""Authenticated, bounded server search over the current user's workspace."""
from typing import Annotated, Literal
from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.text_search import fold_text
from app.core.datetime_utils import utc_mapping
from app.db.models import User, Task, Note
from app.db.calendar import CalendarEvent as Event
from app.db.note_scheduling import NoteCalendarSchedule as Schedule
from app.modules.auth.dependencies import get_current_user
from app.modules.tasks.queries import task_order

router = APIRouter(prefix="/api/search", tags=["Workspace search"])
APPS = [
    {"id": "bookingreports", "title": "Income Statement", "preview": "Báo cáo Thu nhập & Bán hàng. Báo cáo thu nhập, doanh số bán hàng, bảng tính hoa hồng và theo dõi giỏ hàng bất động sản."},
    {"id": "workflows", "title": "Workflows", "preview": "Hệ thống trình ký. Theo dõi luồng xử lý hồ sơ, phê duyệt chứng từ."},
    {"id": "itam", "title": "Asset Manager", "preview": "Quản lý Tài sản. Quản lý cấp phát thiết bị IT, tài sản hành chính, kiểm kê kho và thủ tục tiếp nhận nhân sự."},
]

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
    permissions = {value.strip() for value in (user.allowed_apps or '').split(',')}
    if kind in ('all', 'apps'):
        apps = [app for app in APPS if app['id'] in permissions and keyword in fold_text(app['title'] + ' ' + app['preview'])]
        groups['apps'] = {"items": apps[offset:offset + limit], "total": len(apps)}
    specs = {
        'tasks': (Task, [Task.id, Task.title, func.substr(Task.description, 1, 240).label('preview'), Task.due_date, Task.due_time, Task.is_completed],
                  [Task.user_id == user.id, Task.search_text.contains(keyword, autoescape=True)], task_order(db)),
        'notes': (Note, [Note.id, Note.title, func.substr(Note.content, 1, 240).label('preview'), Note.is_pinned],
                  [Note.user_id == user.id, Note.is_archived.is_(False), Note.search_text.contains(keyword, autoescape=True)],
                  (Note.is_pinned.desc(), Note.created_at.desc(), Note.id)),
        'events': (Event, [Event.id, Event.title, func.substr(Event.description, 1, 240).label('preview'), Event.starts_at, Event.ends_at, Event.location, Event.is_all_day],
                   [Event.user_id == user.id, Event.search_text.contains(keyword, autoescape=True),
                    ~select(Schedule.note_id).where(Schedule.event_id == Event.id).exists()],
                   (Event.starts_at.desc(), Event.id)),
    }
    for name, (model, fields, conditions, order) in specs.items():
        if kind not in ('all', name):
            continue
        total = await db.scalar(select(func.count()).select_from(model).where(*conditions))
        if kind != 'all':
            offset = min(offset, ((total - 1) // limit) * limit) if total else 0
        rows = (await db.execute(select(*fields).where(*conditions).order_by(*order).offset(offset).limit(limit))).mappings().all() if total else []
        groups[name] = {"items": [utc_mapping(row) for row in rows], "total": total}
    return {"groups": groups, "offset": offset, "limit": limit}

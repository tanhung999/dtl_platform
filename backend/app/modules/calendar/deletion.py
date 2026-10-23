"""Delete a calendar series, including its individually edited occurrences."""
from sqlalchemy import select
from app.db.calendar import CalendarEvent
from app.db.calendar_exceptions import CalendarException


async def recurrence_parent(db, event_id, user_id):
    return await db.scalar(select(CalendarException.event_id).join(
        CalendarEvent, CalendarEvent.id == CalendarException.event_id).where(
        CalendarException.replacement_id == event_id, CalendarEvent.user_id == user_id))


async def delete_series(db, event_id, user_id, delete_notes=False):
    # Callers hold the owner's lock, shared by edits and reminder delivery.
    root, visited = event_id, set()
    while root not in visited:
        visited.add(root)
        parent = await recurrence_parent(db, root, user_id)
        if not parent:
            break
        root = parent
    from .scopes import delete_branch
    return await delete_branch(db, root, user_id, delete_notes=delete_notes)

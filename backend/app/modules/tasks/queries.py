"""Shared SQL deadline semantics: an all-day deadline expires at next midnight."""
from sqlalchemy import Date, Time, and_, case, cast, func, literal, or_
from app.db.models import Task
from .deadlines import VN

def overdue_condition(now):
    local = now.astimezone(VN)
    return and_(Task.is_completed.is_(False), or_(Task.due_date < local.date(), and_(Task.due_date == local.date(), Task.due_time <= local.strftime("%H:%M"))))

def task_sort_columns(db):
    priority = case({"URGENT": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3}, value=Task.priority, else_=4)
    if db.bind.dialect.name == "postgresql":
        day = cast(Task.due_date, Date) + case((Task.due_time.is_(None), 1), else_=0)
        clock = func.coalesce(cast(Task.due_time, Time), cast(literal("00:00"), Time))
    else:
        day = func.date(Task.due_date, case((Task.due_time.is_(None), "+1 day"), else_="+0 day"))
        clock = func.coalesce(Task.due_time, literal("00:00:00.000000"))
    return (Task.is_completed, day, clock, priority, Task.display_order, Task.id)


def task_order(db):
    done, day, clock, priority, position, id = task_sort_columns(db)
    return (done, day.asc().nullslast(), clock, priority, position, id)


async def after_task(db, user_id, anchor_id):
    """Seek by the complete sort contract, including NULL dates and priority ties."""
    from sqlalchemy import select
    from fastapi import HTTPException
    revision = None
    if ':' in anchor_id:
        anchor_id, revision = anchor_id.rsplit(':', 1)
        if not revision.isdigit():
            raise HTTPException(422, "Mốc phân trang không hợp lệ.")
    columns = task_sort_columns(db)
    condition = (Task.user_id == user_id, Task.id == anchor_id)
    if revision is not None:
        condition += (Task.version == int(revision),)
    anchor = (await db.execute(select(*columns).where(*condition))).one_or_none()
    if anchor is None:
        raise HTTPException(409, "Mốc phân trang đã bị xóa. Đang tải lại trang đầu.")
    equals, later = [], []
    for index, (column, value) in enumerate(zip(columns, anchor)):
        if value is not None:
            comparison = column.op('>')(value)
            if index == 1:  # Date NULLS LAST, regardless of clock/priority.
                comparison = or_(comparison, column.is_(None))
            later.append(and_(*equals, comparison))
        equals.append(column.is_(None) if value is None else column == value)
    return or_(*later)

"""Result history follows the current task's direct access rules."""
from sqlalchemy import func, select
from app.db.task_history import TaskResultHistory
from .access import accessible_task


async def list_result_history(db, task_id, user, offset, limit):
    await accessible_task(task_id, user, db)
    total = await db.scalar(select(func.count()).select_from(TaskResultHistory).where(TaskResultHistory.task_id == task_id))
    rows = (await db.scalars(select(TaskResultHistory).where(TaskResultHistory.task_id == task_id)
        .order_by(TaskResultHistory.task_version.desc()).offset(offset).limit(limit))).all()
    return {'items':[{key:getattr(row,key) for key in ('id','action','note','occurred_at','is_snapshot')} for row in rows],
            'total':total, 'offset':offset, 'limit':limit, 'has_more':offset+len(rows)<total}

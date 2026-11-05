"""Nhật ký quyền chỉ lưu người thao tác và phạm vi, không lưu nội dung lịch."""
from app.db.access import AccessAuditLog

def record(db, actor, subject, action, changes):
    if action.startswith('application_'):
        from app.core.realtime import mark_changed
        mark_changed(db, subject.id, 'notifications')
    db.add(AccessAuditLog(actor_id=actor.id, subject_id=subject.id, actor_name=actor.full_name,
        subject_name=subject.full_name, actor_username=actor.username, subject_username=subject.username, action=action, changes=changes))

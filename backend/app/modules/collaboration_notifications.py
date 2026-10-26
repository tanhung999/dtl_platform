"""Small idempotent notification writer for assignments and followers."""
import hashlib
from app.db.notifications import Notification
from app.db.models import utcnow


def notify(db, user_id, kind, title, body, resource_type, resource_id, *, task_id=None, event_id=None, revision="0"):
    event_key = f"{kind}:{resource_id}:{user_id}:{revision}"
    db.add(Notification(user_id=user_id, source="platform", event_key=event_key,
        fingerprint=hashlib.sha256(f"{title}\n{body}".encode()).hexdigest(), kind=kind,
        title=title[:255], body=body[:1200], resource_type=resource_type,
        resource_id=resource_id, action_path=f"/{'tasks' if resource_type == 'task' else 'calendar'}",
        task_id=task_id, event_id=event_id, occurred_at=utcnow()))

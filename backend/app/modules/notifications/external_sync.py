"""Versioned two-way read synchronization. No network calls inside user transactions."""

from app.db.models import utcnow
from app.db.notifications import ExternalNotificationState as State
from app.db.notifications import NotificationReadOutbox as Outbox
from fastapi import HTTPException
from sqlalchemy import select


async def record_read_change(db, notice, *, from_source=False):
    state = await db.scalar(
        select(State).where(State.notification_id == notice.id).with_for_update()
    )
    if state is None:
        return  # Local notices and legacy deliveries have no external state contract.
    state.read_version += 1
    queued = await db.get(Outbox, notice.id, with_for_update=True)
    if queued is None and not from_source:
        queued = Outbox(notification_id=notice.id, acknowledged_revision=0)
        db.add(queued)
    if queued is not None:
        queued.revision = state.read_version
        queued.updated_at = utcnow()
        if from_source:
            queued.acknowledged_revision = state.read_version
    await db.flush()


def read_snapshot(notice, state):
    return {
        "id": notice.id,
        "external_id": state.external_id,
        "recipient_subject": state.identity_subject,
        "external_user_id": state.external_user_id,
        "link_operation_id": state.link_operation_id,
        "read": notice.read_at is not None,
        "read_version": state.read_version,
    }


async def apply_source_read(db, notice, state, *, read, expected_version):
    if (notice.read_at is not None) == read:
        return read_snapshot(notice, state)
    if state.read_version != expected_version:
        raise HTTPException(
            409,
            {
                "message": "Trạng thái đã thay đổi. Hãy dùng trạng thái mới nhất.",
                **read_snapshot(notice, state),
            },
        )
    notice.read_at = utcnow() if read else None
    await record_read_change(db, notice, from_source=True)
    from .service import changed

    changed(db, notice.user_id)
    return read_snapshot(notice, state)

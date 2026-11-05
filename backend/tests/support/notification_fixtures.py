from app.db.applications import (
    Application,
    ApplicationPolicyOwnership,
    UserApplicationAccess,
)
from app.db.models import User
from app.db.notifications import ExternalNotificationState

APPS = ("workflows", "itam", "bookingreports")


async def grants(db, *, linked=False):
    for name in ("alice", "bob"):
        user = await db.get(User, name)
        if user is None:
            continue
        user.identity_subject = name + "-subject"
        for app in APPS:
            if not await db.get(Application, app):
                db.add(
                    Application(
                        key=app,
                        display_name=app,
                        launch_url="http://localhost",
                        permission_prefix=app,
                    )
                )
                await db.flush()
            if not await db.get(UserApplicationAccess, (name, app)):
                db.add(
                    UserApplicationAccess(
                        user_id=name, application_key=app, enabled=True
                    )
                )
            if linked:
                await link(db, name, app)
    await db.flush()


async def link(db, name, app):
    row = await db.get(ApplicationPolicyOwnership, (name, app))
    if not row:
        row = ApplicationPolicyOwnership(
            user_id=name,
            application_key=app,
            external_user_id=name + "-external",
            operation_id=name + "-" + app + "-link",
            role_keys=[],
            imported_snapshot={},
        )
        db.add(row)
        await db.flush()
    return row


async def bind_notice(db, notice):
    owner = await link(db, notice.user_id, notice.source)
    db.add(
        ExternalNotificationState(
            notification_id=notice.id,
            external_id=notice.event_key,
            identity_subject=notice.user_id + "-subject",
            external_user_id=owner.external_user_id,
            link_operation_id=owner.operation_id,
            read_version=0,
        )
    )


async def bind_history(db):
    from app.db.notifications import Notification
    from sqlalchemy import select

    await db.flush()
    notices = (
        await db.scalars(select(Notification).where(Notification.source != "platform"))
    ).all()
    if notices:
        await grants(db, linked=True)
    for notice in notices:
        if not await db.get(ExternalNotificationState, notice.id):
            await bind_notice(db, notice)

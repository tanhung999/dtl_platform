"""Use the current application grants, not the legacy comma-separated app list."""

from app.db.applications import (
    Application,
    ApplicationPolicyOwnership,
    UserApplicationAccess,
    ApplicationProvisioningPolicy,
)
from app.db.models import User
from app.db.notifications import ExternalNotificationState as State
from app.db.notifications import Notification as N
from fastapi import HTTPException
from sqlalchemy import select


def application_access(user_id, source):
    return (
        select(UserApplicationAccess.user_id)
        .join(Application, Application.key == UserApplicationAccess.application_key)
        .where(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.application_key == source,
            UserApplicationAccess.enabled.is_(True),
            Application.is_active.is_(True),
            ~select(ApplicationProvisioningPolicy.user_id).where(
                ApplicationProvisioningPolicy.user_id == UserApplicationAccess.user_id,
                ApplicationProvisioningPolicy.application_key == UserApplicationAccess.application_key,
                ApplicationProvisioningPolicy.unlink_operation_id.is_not(None),
            ).correlate(UserApplicationAccess).exists(),
        )
    )


async def require_application_access(db, user_id, source):
    if not await db.scalar(application_access(user_id, source)):
        raise HTTPException(403, "Bạn không còn quyền truy cập ứng dụng này.")


def external_visibility():
    access = application_access(N.user_id, N.source).correlate(N).exists()
    binding = (
        select(State.notification_id)
        .join(User, User.id == N.user_id)
        .join(
            ApplicationPolicyOwnership,
            (ApplicationPolicyOwnership.user_id == N.user_id)
            & (ApplicationPolicyOwnership.application_key == N.source),
        )
        .where(
            State.notification_id == N.id,
            State.source_visible.is_(True),
            User.is_active.is_(True),
            State.identity_subject == User.identity_subject,
            State.external_user_id == ApplicationPolicyOwnership.external_user_id,
            State.link_operation_id == ApplicationPolicyOwnership.operation_id,
        )
        .correlate(N)
        .exists()
    )
    return access & binding


async def notification_binding(db, user, source):
    await require_application_access(db, user.id, source)
    link = await db.get(ApplicationPolicyOwnership, (user.id, source))
    if not link or not user.identity_subject:
        raise HTTPException(
            403, "Tài khoản chưa được xác nhận liên kết với ứng dụng này."
        )
    return {
        "identity_subject": user.identity_subject,
        "external_user_id": link.external_user_id,
        "link_operation_id": link.operation_id,
    }

"""Private application entitlement contract used by trusted DTL services."""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.db.applications import (
    Application,
    ApplicationPermission,
    ApplicationRole,
    ApplicationRolePermission,
    UserApplicationAccess,
)
from app.db.models import User


router = APIRouter(prefix="/api/integrations", tags=["Application integrations"])
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]


class EntitlementView(BaseModel):
    allowed: bool
    application: str
    subject: str
    user_id: str | None = None
    username: str | None = None
    email: str | None = None
    full_name: str | None = None
    department: str | None = None
    role_key: str | None = None
    permission_keys: list[str] = Field(default_factory=list)
    project_names: list[str] = Field(default_factory=list)


def _authorize(application_key: str, secret: str | None) -> None:
    application_secrets = {
        "bookingreports": settings.INTEGRATION_BOOKINGREPORTS_SECRET,
        "workflows": settings.INTEGRATION_WORKFLOWS_SECRET,
        "itam": settings.INTEGRATION_ITAM_SECRET,
    }
    expected = application_secrets.get(application_key, "")
    if not expected and (settings.APP_ENV.lower() != "production" or settings.ALLOW_INSECURE_LOCAL_CONFIG):
        expected = settings.INTEGRATION_SHARED_SECRET
    if not expected:
        raise HTTPException(503, "Kênh kiểm tra quyền ứng dụng chưa được cấu hình.")
    if not secret or not secrets.compare_digest(secret, expected):
        raise HTTPException(401, "Thông tin xác thực tích hợp không hợp lệ.")


@router.get("/applications/{application_key}/subjects/{subject}", response_model=EntitlementView)
async def check_subject_entitlement(
    application_key: str,
    subject: str,
    db: Database,
    integration_secret: Annotated[str | None, Header(alias="X-DTL-Integration-Secret")] = None,
):
    _authorize(application_key, integration_secret)
    row = (
        await db.execute(
            select(User, UserApplicationAccess)
            .join(
                UserApplicationAccess,
                UserApplicationAccess.user_id == User.id,
            )
            .join(Application, Application.key == UserApplicationAccess.application_key)
            .where(
                User.identity_subject == subject,
                User.is_active.is_(True),
                UserApplicationAccess.application_key == application_key,
                UserApplicationAccess.enabled.is_(True),
                Application.is_active.is_(True),
            )
        )
    ).one_or_none()
    if not row:
        return EntitlementView(allowed=False, application=application_key, subject=subject)
    user, grant = row
    role = await db.get(ApplicationRole, grant.role_id) if grant.role_id else None
    permission_keys = set()
    if role and role.application_key == application_key:
        permission_keys.update((await db.scalars(
            select(ApplicationPermission.code)
            .join(ApplicationRolePermission, ApplicationRolePermission.permission_id == ApplicationPermission.id)
            .where(ApplicationRolePermission.role_id == role.id)
        )).all())
    for code, allowed in (grant.permission_overrides or {}).items():
        permission_keys.add(code) if allowed else permission_keys.discard(code)
    return EntitlementView(
        allowed=True,
        application=application_key,
        subject=subject,
        user_id=user.id,
        username=user.username,
        email=user.email,
        full_name=user.full_name,
        department=user.department,
        role_key=role.key if role else None,
        permission_keys=sorted(permission_keys),
        project_names=sorted(grant.project_names or []),
    )

import re
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.db.applications import (
    Application,
    ApplicationPermission,
    ApplicationRole,
    ApplicationRolePermission,
    UserApplicationAccess,
)
from app.db.models import User, utcnow
from app.modules.access.audit import record
from app.modules.access.service import MANAGE, require
from app.modules.auth.dependencies import get_current_user
from app.modules.applications.service import listed_applications_query

router = APIRouter(prefix="/api/applications", tags=["Applications"])
admin_router = APIRouter(prefix="/api/admin/applications", tags=["Application administration"])
CurrentUser = Annotated[User, Depends(get_current_user)]
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]


class ApplicationView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    display_name: str
    description: str
    category: str
    icon_key: str
    icon_url: str | None
    launch_url: str
    permission_prefix: str
    is_active: bool
    legacy_login_enabled: bool
    sort_order: int


class ApplicationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    key: str = Field(min_length=2, max_length=80)
    display_name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=2000)
    category: str = Field(default="Ứng dụng doanh nghiệp", min_length=2, max_length=100)
    icon_key: str = Field(default="platform", min_length=2, max_length=80)
    icon_url: str | None = Field(default=None, max_length=500)
    launch_url: str = Field(min_length=8, max_length=1000)
    callback_path: str = Field(default="/sso-callback", min_length=1, max_length=255)
    oidc_client_id: str | None = Field(default=None, max_length=160)
    oidc_audience: str | None = Field(default=None, max_length=160)
    permission_prefix: str = Field(min_length=2, max_length=100)
    is_active: bool = True
    legacy_login_enabled: bool = False
    sort_order: int = Field(default=100, ge=0, le=10000)


    @field_validator("key", "permission_prefix")
    @classmethod
    def valid_key(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]*", value):
            raise ValueError("Chỉ chấp nhận chữ thường, số, dấu chấm, gạch ngang và gạch dưới.")
        return value

    @field_validator("launch_url")
    @classmethod
    def valid_launch_url(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.query or parsed.fragment:
            raise ValueError("URL ứng dụng không hợp lệ.")
        return value

    @field_validator("callback_path")
    @classmethod
    def valid_callback_path(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("/") or value.startswith("//") or "?" in value or "#" in value:
            raise ValueError("Callback path không hợp lệ.")
        return value


class LegacyLoginPolicyInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool


class AccessInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    expected_updated_at: str | None = Field(default=None, max_length=64)
    role_key: str | None = Field(default=None, max_length=100)
    permission_keys: list[str] | None = None
    project_names: list[str] | None = None

    @field_validator("permission_keys", "project_names")
    @classmethod
    def unique_values(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return sorted({item.strip() for item in value if item.strip()})


class ApplicationPermissionView(BaseModel):
    code: str
    display_name: str
    group_name: str


class ApplicationRoleView(BaseModel):
    key: str
    display_name: str
    description: str
    permission_keys: list[str]


class PermissionManifestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str = Field(min_length=2, max_length=140)
    display_name: str = Field(min_length=2, max_length=220)
    group_name: str = Field(default="Chức năng", min_length=2, max_length=120)
    sort_order: int = Field(default=100, ge=0, le=10000)


class RoleManifestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str = Field(min_length=1, max_length=100)
    display_name: str = Field(min_length=2, max_length=180)
    description: str = Field(default="", max_length=2000)
    permission_keys: list[str] = Field(default_factory=list)
    sort_order: int = Field(default=100, ge=0, le=10000)


class ApplicationManifestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application: ApplicationInput
    permissions: list[PermissionManifestInput] = Field(default_factory=list)
    roles: list[RoleManifestInput] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_catalog(self):
        permission_codes = [item.code for item in self.permissions]
        role_keys = [item.key for item in self.roles]
        if len(permission_codes) != len(set(permission_codes)):
            raise ValueError("Permission trong manifest không được trùng mã.")
        if len(role_keys) != len(set(role_keys)):
            raise ValueError("Role trong manifest không được trùng mã.")
        unknown = sorted({code for role in self.roles for code in role.permission_keys} - set(permission_codes))
        if unknown:
            raise ValueError(f"Role tham chiếu permission chưa khai báo: {', '.join(unknown)}")
        return self


class UserApplicationAccessView(BaseModel):
    key: str
    display_name: str
    description: str
    icon_key: str
    enabled: bool
    access_updated_at: str | None = None
    role_key: str | None = None
    role_display_name: str | None = None
    role_keys: list[str] = Field(default_factory=list)
    policy_import_id: str | None = None
    linked_account_id: str | None = None
    permission_keys: list[str] = Field(default_factory=list)
    project_names: list[str] = Field(default_factory=list)
    roles: list[ApplicationRoleView] = Field(default_factory=list)
    permissions: list[ApplicationPermissionView] = Field(default_factory=list)


async def _access_view(
    db: AsyncSession,
    application: Application,
    grant: UserApplicationAccess | None,
) -> UserApplicationAccessView:
    roles = list((await db.scalars(
        select(ApplicationRole)
        .where(ApplicationRole.application_key == application.key)
        .order_by(ApplicationRole.sort_order, ApplicationRole.display_name)
    )).all())
    permissions = list((await db.scalars(
        select(ApplicationPermission)
        .where(ApplicationPermission.application_key == application.key)
        .order_by(ApplicationPermission.group_name, ApplicationPermission.sort_order, ApplicationPermission.code)
    )).all())
    links = (await db.execute(
        select(ApplicationRolePermission.role_id, ApplicationPermission.code)
        .join(ApplicationPermission, ApplicationPermission.id == ApplicationRolePermission.permission_id)
        .where(ApplicationPermission.application_key == application.key)
    )).all()
    permissions_by_role: dict[str, set[str]] = {role.id: set() for role in roles}
    for role_id, code in links:
        permissions_by_role.setdefault(role_id, set()).add(code)
    selected_role = next((role for role in roles if grant and role.id == grant.role_id), None)
    from app.db.applications import ApplicationPolicyOwnership
    ownership = await db.get(ApplicationPolicyOwnership, (grant.user_id, application.key)) if grant else None
    selected_keys = ownership.role_keys if ownership else ([selected_role.key] if selected_role else [])
    effective = set().union(*(permissions_by_role.get(role.id, set()) for role in roles if role.key in selected_keys))
    for code, allowed in ((grant.permission_overrides if grant else {}) or {}).items():
        effective.add(code) if allowed else effective.discard(code)
    # Booking's admin role bypasses per-permission checks in the destination.
    # Report its actual semantics instead of displaying ineffective denials.
    if application.key == 'bookingreports' and selected_role and selected_role.key == 'admin':
        effective = {permission.code for permission in permissions}
    return UserApplicationAccessView(
        key=application.key,
        display_name=application.display_name,
        description=application.description,
        icon_key=application.icon_key,
        enabled=bool(grant and grant.enabled),
        access_updated_at=grant.updated_at.isoformat() if grant else None,
        role_key=selected_role.key if selected_role else None,
        role_display_name=', '.join(role.display_name for role in roles if role.key in selected_keys) or None,
        role_keys=selected_keys,
        policy_import_id=ownership.operation_id if ownership else None,
        linked_account_id=ownership.external_user_id if ownership else None,
        permission_keys=sorted(effective),
        project_names=sorted((grant.project_names if grant else []) or []),
        roles=[ApplicationRoleView(
            key=role.key,
            display_name=role.display_name,
            description=role.description,
            permission_keys=sorted(permissions_by_role.get(role.id, set())),
        ) for role in roles],
        permissions=[ApplicationPermissionView(
            code=permission.code,
            display_name=permission.display_name,
            group_name=permission.group_name,
        ) for permission in permissions],
    )


@router.get("/me", response_model=list[ApplicationView])
async def my_applications(user: CurrentUser, db: Database):
    return list((await db.scalars(listed_applications_query())).all())


@admin_router.get("", response_model=list[ApplicationView])
async def list_applications(user: CurrentUser, db: Database):
    await require(db, user.id, MANAGE)
    return list((await db.scalars(select(Application).order_by(Application.sort_order, Application.key))).all())


@admin_router.put("/{application_key}", response_model=ApplicationView)
async def upsert_application(
    application_key: str, payload: ApplicationInput, user: CurrentUser, db: Database
):
    await require(db, user.id, MANAGE)
    if application_key != payload.key:
        raise HTTPException(422, "Mã ứng dụng trên URL và nội dung phải giống nhau.")
    application = await db.get(Application, application_key)
    if application is None:
        application = Application()
        db.add(application)
    for key, value in payload.model_dump().items():
        setattr(application, key, value)
    await db.flush()
    return application


@admin_router.patch("/{application_key}/legacy-login", response_model=ApplicationView)
async def update_legacy_login_policy(
    application_key: str, payload: LegacyLoginPolicyInput, user: CurrentUser, db: Database
):
    await require(db, user.id, MANAGE)
    application = await db.get(Application, application_key)
    if application is None:
        raise HTTPException(404, "Ứng dụng không tồn tại.")
    application.legacy_login_enabled = payload.enabled
    record(db, user, user, "application.legacy_login.updated", {
        "application": application_key,
        "enabled": payload.enabled,
    })
    await db.flush()
    return application


@admin_router.put("/{application_key}/manifest", response_model=ApplicationView)
async def apply_application_manifest(
    application_key: str,
    payload: ApplicationManifestInput,
    user: CurrentUser,
    db: Database,
):
    """Idempotently register an app and its authorization catalog."""
    await require(db, user.id, MANAGE)
    if application_key != payload.application.key:
        raise HTTPException(422, "Mã ứng dụng trên URL và manifest phải giống nhau.")
    application = await db.get(Application, application_key)
    if application is None:
        application = Application()
        db.add(application)
    application_values = payload.application.model_dump()
    if application.key:
        # The manifest owns application metadata, while this policy is managed
        # explicitly by Platform administrators and must survive re-registration.
        application_values.pop("legacy_login_enabled", None)
    for key, value in application_values.items():
        setattr(application, key, value)
    await db.flush()

    permissions: dict[str, ApplicationPermission] = {}
    for item in payload.permissions:
        permission_id = f"{application_key}:{item.code}"
        permission = await db.get(ApplicationPermission, permission_id)
        if permission is None:
            permission = ApplicationPermission(
                id=permission_id, application_key=application_key
            )
            db.add(permission)
        permission.code = item.code
        permission.display_name = item.display_name
        permission.group_name = item.group_name
        permission.sort_order = item.sort_order
        permissions[item.code] = permission
    await db.flush()

    for item in payload.roles:
        role_id = f"{application_key}:{item.key}"
        role = await db.get(ApplicationRole, role_id)
        if role is None:
            role = ApplicationRole(id=role_id, application_key=application_key)
            db.add(role)
        role.key = item.key
        role.display_name = item.display_name
        role.description = item.description
        role.sort_order = item.sort_order
        await db.flush()
        await db.execute(
            delete(ApplicationRolePermission).where(
                ApplicationRolePermission.role_id == role_id
            )
        )
        for code in item.permission_keys:
            db.add(
                ApplicationRolePermission(
                    role_id=role_id,
                    permission_id=permissions[code].id,
                )
            )
    await db.flush()
    return application


@admin_router.put("/{application_key}/users/{target_id}", response_model=UserApplicationAccessView)
async def set_user_access(
    application_key: str,
    target_id: str,
    payload: AccessInput,
    user: CurrentUser,
    db: Database,
    background_tasks: BackgroundTasks,
):
    await require(db, user.id, MANAGE)
    application = await db.get(Application, application_key)
    target = await db.get(User, target_id, with_for_update=True, populate_existing=True)
    if not application:
        raise HTTPException(404, "Không tìm thấy ứng dụng.")
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    grant = await db.get(UserApplicationAccess, (target_id, application_key), with_for_update=True, populate_existing=True)
    from app.db.applications import ApplicationPolicyOwnership
    ownership = await db.get(ApplicationPolicyOwnership, (target_id, application_key))
    if ((payload.expected_updated_at is not None or ownership is not None)
            and payload.expected_updated_at != (grant.updated_at.isoformat() if grant else None)):
        raise HTTPException(409, 'Quyền ứng dụng vừa thay đổi. Hãy tải lại trước khi lưu.')
    previous = {
        "enabled": bool(grant and grant.enabled),
        "role_id": grant.role_id if grant else None,
        "permission_overrides": (grant.permission_overrides if grant else {}) or {},
        "project_names": (grant.project_names if grant else []) or [],
        "role_keys": list(ownership.role_keys) if ownership else [],
    }
    if grant is None:
        grant = UserApplicationAccess(
            user_id=target_id,
            application_key=application_key,
            granted_by_id=user.id,
        )
        db.add(grant)
    grant.enabled = payload.enabled
    grant.granted_by_id = user.id
    roles = list((await db.scalars(
        select(ApplicationRole)
        .where(ApplicationRole.application_key == application_key)
        .order_by(ApplicationRole.sort_order)
    )).all())
    selected_role = next((role for role in roles if role.key == payload.role_key), None)
    role_changed = selected_role is not None and (selected_role.id != grant.role_id or
        (ownership is not None and ownership.role_keys != [selected_role.key]))
    if payload.role_key is not None and selected_role is None:
        raise HTTPException(422, "Role không thuộc ứng dụng này.")
    if selected_role is not None:
        grant.role_id = selected_role.id
        if ownership and role_changed:
            ownership.role_keys = [selected_role.key]
            grant.updated_at = utcnow()
    elif grant.role_id is None and payload.enabled and ownership is None:
        from .default_roles import default_role
        selected_role = default_role(application_key, roles)
        grant.role_id = selected_role.id if selected_role else None
    else:
        selected_role = next((role for role in roles if role.id == grant.role_id), None)

    if payload.permission_keys is not None:
        catalog = list((await db.scalars(
            select(ApplicationPermission).where(ApplicationPermission.application_key == application_key)
        )).all())
        valid_codes = {permission.code for permission in catalog}
        requested = set(payload.permission_keys)
        unknown = sorted(requested - valid_codes)
        if unknown:
            raise HTTPException(422, f"Permission không thuộc ứng dụng: {', '.join(unknown)}")
        if application_key == 'bookingreports' and selected_role and selected_role.key == 'admin' and requested != valid_codes:
            raise HTTPException(422, 'Vai trò Quản trị viên của Booking 360 có toàn quyền. Chọn vai trò khác nếu muốn giới hạn quyền.')
        base_codes = set()
        if selected_role:
            base_codes = set((await db.scalars(
                select(ApplicationPermission.code)
                .join(ApplicationRolePermission, ApplicationRolePermission.permission_id == ApplicationPermission.id)
                .where(ApplicationRolePermission.role_id.in_([role.id for role in roles if role.key in ownership.role_keys] if ownership else [selected_role.id]))
            )).all())
        grant.permission_overrides = {
            code: code in requested
            for code in valid_codes
            if (code in requested) != (code in base_codes)
        }
    elif role_changed:
        grant.permission_overrides = {}
    if payload.project_names is not None:
        grant.project_names = payload.project_names
    await db.flush()
    current = {
        "enabled": grant.enabled,
        "role_id": grant.role_id,
        "permission_overrides": grant.permission_overrides or {},
        "project_names": grant.project_names or [],
        "role_keys": list(ownership.role_keys) if ownership else [],
    }
    record(
        db,
        user,
        target,
        "application_access_updated",
        {"application": application_key, "before": previous, "after": current},
    )
    if application_key == 'workflows' and previous != current:
        from .policy_notifications import notify_workflow_policy_changed
        # Database's function-scoped dependency commits before BackgroundTasks run.
        background_tasks.add_task(notify_workflow_policy_changed, target.id, target.identity_subject)
    elif application_key in {'itam', 'bookingreports'} and previous != current:
        from .policy_notifications import notify_application_policy_changed
        background_tasks.add_task(notify_application_policy_changed, application_key, target.id, target.identity_subject)
    return await _access_view(db, application, grant)


@admin_router.get("/users/{target_id}/access", response_model=list[UserApplicationAccessView])
async def user_application_access(target_id: str, user: CurrentUser, db: Database):
    await require(db, user.id, MANAGE)
    target = await db.get(User, target_id)
    if not target:
        raise HTTPException(404, "Không tìm thấy tài khoản.")
    grants = {
        grant.application_key: grant
        for grant in (
            await db.scalars(
                select(UserApplicationAccess).where(UserApplicationAccess.user_id == target_id)
            )
        ).all()
    }
    applications = (
        await db.scalars(select(Application).order_by(Application.sort_order, Application.key))
    ).all()
    return [
        await _access_view(db, application, grants.get(application.key))
        for application in applications if application.is_active
    ]

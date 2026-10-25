"""Create and backfill the dynamic application registry."""

from sqlalchemy import select

from app.core.config import settings
from app.db.applications import Application, UserApplicationAccess
from app.db.models import User
from app.db.access import AccessPermission, AccessRole, RolePermission
from app.modules.access.service import APPLICATIONS_MANAGE


DEFAULT_APPLICATIONS = (
    {
        "key": "bookingreports",
        "display_name": "DT Income Statement",
        "description": "Báo cáo thu nhập, doanh số, hoa hồng và giỏ hàng bất động sản.",
        "icon_key": "income",
        "launch_url": settings.BOOKING_REPORTS_URL,
        "callback_path": "/api/auth/platform/callback",
        "permission_prefix": "bookingreports",
        "oidc_client_id": "bookingreports",
        "oidc_audience": "bookingreports",
        "sort_order": 10,
    },
    {
        "key": "workflows",
        "display_name": "DT Workflow",
        "description": "Theo dõi luồng xử lý hồ sơ và phê duyệt chứng từ.",
        "icon_key": "workflow",
        "launch_url": settings.WORKFLOWS_URL,
        "callback_path": "/api/auth/platform/callback",
        "permission_prefix": "workflows",
        "oidc_client_id": "workflows",
        "oidc_audience": "workflows",
        "sort_order": 20,
    },
    {
        "key": "itam",
        "display_name": "DT Assets",
        "description": "Quản lý tài sản, thiết bị, kho và thủ tục tiếp nhận nhân sự.",
        "icon_key": "assets",
        "launch_url": settings.ASSET_MANAGER_URL,
        "callback_path": "/api/auth/platform/callback",
        "permission_prefix": "asset-manager",
        "oidc_client_id": "asset-manager",
        "oidc_audience": "asset-manager",
        "sort_order": 30,
    },
)


async def migrate_application_registry(conn) -> None:
    """Seed legacy apps and convert the old comma-separated grants once."""
    if not await conn.scalar(select(AccessRole.id).where(AccessRole.id == "access_admin")):
        await conn.execute(
            AccessRole.__table__.insert().values(id="access_admin", name="Quản lý cấp quyền")
        )
    if not await conn.scalar(
        select(AccessPermission.code).where(AccessPermission.code == APPLICATIONS_MANAGE)
    ):
        await conn.execute(
            AccessPermission.__table__.insert().values(
                code=APPLICATIONS_MANAGE,
                name="Quản lý ứng dụng và quyền truy cập ứng dụng",
            )
        )
    if not await conn.scalar(
        select(RolePermission.role_id).where(
            RolePermission.role_id == "access_admin",
            RolePermission.permission_code == APPLICATIONS_MANAGE,
        )
    ):
        await conn.execute(
            RolePermission.__table__.insert().values(
                role_id="access_admin", permission_code=APPLICATIONS_MANAGE
            )
        )

    for values in DEFAULT_APPLICATIONS:
        exists = await conn.scalar(
            select(Application.key).where(Application.key == values["key"])
        )
        if not exists:
            await conn.execute(Application.__table__.insert().values(**values))
        elif values["key"] in {"bookingreports", "workflows"}:
            current_path = await conn.scalar(
                select(Application.callback_path).where(Application.key == values["key"])
            )
            if current_path == "/sso-callback":
                await conn.execute(
                    Application.__table__.update()
                    .where(Application.key == values["key"])
                    .values(callback_path="/api/auth/oidc/login")
                )
            current_url = await conn.scalar(
                select(Application.launch_url).where(Application.key == values["key"])
            )
            legacy_urls = {"http://localhost:5174"} if values["key"] == "bookingreports" else {"http://localhost:8080"}
            if current_url in legacy_urls:
                await conn.execute(
                    Application.__table__.update()
                    .where(Application.key == values["key"])
                    .values(launch_url=values["launch_url"])
                )

    users = (await conn.execute(select(User.id, User.allowed_apps))).all()
    for user_id, allowed_apps in users:
        for application_key in {
            value.strip() for value in (allowed_apps or "").split(",") if value.strip()
        }:
            app_exists = await conn.scalar(
                select(Application.key).where(Application.key == application_key)
            )
            if not app_exists:
                continue
            granted = await conn.scalar(
                select(UserApplicationAccess.user_id).where(
                    UserApplicationAccess.user_id == user_id,
                    UserApplicationAccess.application_key == application_key,
                )
            )
            if not granted:
                await conn.execute(
                    UserApplicationAccess.__table__.insert().values(
                        user_id=user_id,
                        application_key=application_key,
                        enabled=True,
                    )
                )

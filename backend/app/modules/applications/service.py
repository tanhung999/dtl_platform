from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.applications import Application, UserApplicationAccess


def listed_applications_query():
    """The discoverable catalog is independent of permission to launch an app."""
    return select(Application).order_by(Application.sort_order, Application.display_name, Application.key)


def accessible_applications_query(user_id: str):
    return (
        select(Application)
        .join(
            UserApplicationAccess,
            UserApplicationAccess.application_key == Application.key,
        )
        .where(
            UserApplicationAccess.user_id == user_id,
            UserApplicationAccess.enabled.is_(True),
            Application.is_active.is_(True),
        )
    )


async def has_application_access(
    db: AsyncSession, user_id: str, application_key: str
) -> bool:
    return bool(
        await db.scalar(
            select(UserApplicationAccess.user_id)
            .join(Application, Application.key == UserApplicationAccess.application_key)
            .where(
                UserApplicationAccess.user_id == user_id,
                UserApplicationAccess.application_key == application_key,
                UserApplicationAccess.enabled.is_(True),
                Application.is_active.is_(True),
            )
        )
    )


async def get_accessible_application(
    db: AsyncSession, user_id: str, application_key: str
) -> Application | None:
    return await db.scalar(
        accessible_applications_query(user_id).where(Application.key == application_key)
    )

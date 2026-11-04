"""Add opt-in per-account policies and retire only the original shared link samples."""

from sqlalchemy import delete, or_, and_
from app.db.applications import ApplicationProvisioningPolicy
from app.db.models import Bookmark


async def migrate_per_user_provisioning(conn):
    await conn.run_sync(
        lambda sync: ApplicationProvisioningPolicy.__table__.create(
            sync, checkfirst=True
        )
    )
    await conn.execute(
        delete(Bookmark).where(
            Bookmark.is_global.is_(True),
            Bookmark.user_id.is_(None),
            Bookmark.category == "Hệ thống nội bộ",
            or_(
                and_(
                    Bookmark.title == "Webmail Đông Tây Land",
                    Bookmark.url.in_(
                        ["https://mail.dongtayland.vn", "https://mail.dongtayland.vn/"]
                    ),
                ),
                and_(
                    Bookmark.title == "Cổng thông tin nhân sự",
                    Bookmark.url.in_(
                        ["https://hrm.dongtayland.vn", "https://hrm.dongtayland.vn/"]
                    ),
                ),
            ),
        )
    )

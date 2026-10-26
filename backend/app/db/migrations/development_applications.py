"""Register applications that are visible in the launcher but not released yet."""

from sqlalchemy import select

from app.db.applications import Application


DEVELOPMENT_APPLICATIONS = (
    {
        "key": "hrm",
        "display_name": "DT HRM",
        "description": "Quản lý nhân sự, cơ cấu tổ chức và vận hành nguồn lực.",
        "icon_key": "hrm",
        "launch_url": "",
        "callback_path": "",
        "permission_prefix": "hrm",
        "is_active": False,
        "sort_order": 40,
    },
    {
        "key": "sales-commission",
        "display_name": "DT Sales Commission",
        "description": "Quản lý chính sách, đối soát và chi trả hoa hồng kinh doanh.",
        "icon_key": "salesCommission",
        "launch_url": "",
        "callback_path": "",
        "permission_prefix": "sales-commission",
        "is_active": False,
        "sort_order": 50,
    },
)


async def migrate_development_applications(conn) -> None:
    for values in DEVELOPMENT_APPLICATIONS:
        exists = await conn.scalar(
            select(Application.key).where(Application.key == values["key"])
        )
        if not exists:
            await conn.execute(Application.__table__.insert().values(**values))


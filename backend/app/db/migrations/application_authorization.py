"""Per-application roles, permissions and user scopes."""

from sqlalchemy import inspect, select, text

from app.db.applications import (
    ApplicationPermission,
    ApplicationRole,
    ApplicationRolePermission,
    UserApplicationAccess,
)
from app.db.models import User


BOOKING_PERMISSION_NAMES = {
    'analytics:view': 'Xem Phân tích & Báo cáo', 'approvals:view': 'Xem Phê duyệt',
    'audit:view': 'Xem Nhật ký hệ thống', 'bookings:approve_payment': 'Duyệt thu tiền Booking',
    'bookings:complete': 'Hoàn tất Booking', 'bookings:convert': 'Chuyển cọc giữ chỗ',
    'bookings:create': 'Tạo Booking', 'bookings:delete': 'Xóa/Hủy Booking',
    'bookings:edit': 'Chỉnh sửa Booking', 'bookings:priority': 'Quản lý ưu tiên Booking',
    'bookings:view': 'Xem Booking', 'commissions:edit': 'Chỉnh sửa hoa hồng',
    'commissions:manage_all': 'Quản lý hoa hồng toàn hệ thống', 'commissions:view': 'Xem hoa hồng',
    'commissions:view_branch': 'Xem hoa hồng sàn', 'commissions:view_department': 'Xem hoa hồng phòng',
    'commissions:view_f2': 'Xem hoa hồng F2', 'commissions:view_project': 'Xem hoa hồng dự án',
    'commissions:view_sale': 'Xem hoa hồng cá nhân', 'contracts:edit': 'Chỉnh sửa hợp đồng',
    'contracts:view': 'Xem hợp đồng', 'customers:edit': 'Quản lý khách hàng',
    'customers:view': 'Xem khách hàng', 'customers:view_sensitive': 'Xem CCCD và SĐT đầy đủ',
    'deposits:approve': 'Duyệt hoàn cọc/chuyển dự án', 'deposits:edit': 'Lập phiếu cọc',
    'deposits:refund_review': 'Kiểm tra hoàn cọc', 'deposits:view': 'Xem cọc và giao dịch',
    'developer_commissions:approve': 'Duyệt hoa hồng chủ đầu tư',
    'developer_commissions:edit': 'Cấu hình hoa hồng chủ đầu tư',
    'developer_commissions:view': 'Xem hoa hồng chủ đầu tư', 'finance:edit': 'Chỉnh sửa tài chính',
    'finance:view': 'Xem tài chính', 'lookups:manage': 'Quản lý danh mục',
    'lookups:view': 'Xem danh mục', 'products:delete': 'Xóa sản phẩm',
    'products:edit': 'Chỉnh sửa sản phẩm', 'products:price_approve': 'Duyệt giá thực tế',
    'products:price_edit': 'Nhập/sửa giá thực tế', 'products:view': 'Xem sản phẩm',
    'projects:manage': 'Quản lý dự án', 'projects:view': 'Xem dự án',
    'receipts:confirm': 'Xác nhận dòng tiền', 'receipts:edit': 'Lập phiếu thu',
    'receipts:view': 'Xem phiếu thu', 'reconciliation:edit': 'Đối soát ngân hàng',
    'reconciliation:view': 'Xem đối soát', 'sales:manage': 'Quản lý đội ngũ kinh doanh',
    'tracking:edit': 'Chỉnh sửa theo dõi thanh toán', 'tracking:view': 'Xem theo dõi thanh toán',
    'users:manage': 'Quản trị tài khoản và phân quyền',
}


def _codes(value: str) -> set[str]:
    return {item for item in value.split() if item}


BOOKING_ROLES = {
    'sales': ('Nhân viên Kinh doanh', _codes('approvals:view bookings:view commissions:view commissions:view_sale contracts:view deposits:view products:view projects:view receipts:view'), 10),
    'sales_manager': ('Trưởng phòng Kinh doanh', _codes('analytics:view approvals:view bookings:view commissions:view commissions:view_department commissions:view_sale contracts:view customers:view_sensitive deposits:view products:view projects:view receipts:view sales:manage'), 20),
    'secretary': ('Nhân viên Thư ký KD', _codes('approvals:view bookings:complete bookings:create bookings:edit bookings:priority bookings:view contracts:edit contracts:view customers:edit customers:view customers:view_sensitive deposits:edit deposits:view developer_commissions:edit developer_commissions:view products:price_edit products:view projects:view receipts:view tracking:edit tracking:view'), 30),
    'lead_secretary': ('Trưởng nhóm Thư ký KD', _codes('analytics:view approvals:view bookings:approve_payment bookings:complete bookings:convert bookings:create bookings:delete bookings:edit bookings:priority bookings:view commissions:manage_all commissions:view commissions:view_branch commissions:view_department commissions:view_f2 commissions:view_project commissions:view_sale contracts:edit contracts:view customers:edit customers:view customers:view_sensitive deposits:approve deposits:edit deposits:view developer_commissions:approve developer_commissions:edit developer_commissions:view lookups:manage lookups:view products:edit products:price_approve products:price_edit products:view projects:manage projects:view receipts:confirm receipts:edit receipts:view reconciliation:view tracking:edit tracking:view'), 40),
    'accountant': ('Kế toán', _codes('approvals:view bookings:view contracts:view customers:view customers:view_sensitive deposits:refund_review deposits:view developer_commissions:approve developer_commissions:edit developer_commissions:view finance:edit finance:view products:view receipts:confirm receipts:edit receipts:view reconciliation:edit reconciliation:view tracking:view'), 50),
    'project_director': ('Giám đốc Dự án', _codes('analytics:view approvals:view bookings:view commissions:view commissions:view_project commissions:view_sale contracts:view customers:view_sensitive deposits:view developer_commissions:view finance:view lookups:view products:edit products:view projects:manage projects:view receipts:view sales:manage tracking:view'), 60),
    'branch_director': ('Giám đốc Sàn', _codes('analytics:view approvals:view bookings:view commissions:view commissions:view_branch commissions:view_department commissions:view_sale contracts:view customers:view_sensitive deposits:view finance:view lookups:view products:view projects:view receipts:view sales:manage tracking:view'), 70),
    'admin': ('Quản trị viên', set(BOOKING_PERMISSION_NAMES), 90),
}


async def migrate_application_authorization(conn) -> None:
    await conn.run_sync(lambda sync: ApplicationRole.__table__.create(sync, checkfirst=True))
    await conn.run_sync(lambda sync: ApplicationPermission.__table__.create(sync, checkfirst=True))
    await conn.run_sync(lambda sync: ApplicationRolePermission.__table__.create(sync, checkfirst=True))
    columns = await conn.run_sync(
        lambda sync: {column['name'] for column in inspect(sync).get_columns('user_application_access')}
    )
    json_type = 'JSON' if conn.dialect.name == 'postgresql' else 'TEXT'
    if 'role_id' not in columns:
        await conn.execute(text('ALTER TABLE user_application_access ADD COLUMN role_id VARCHAR(180)'))
    if 'permission_overrides' not in columns:
        await conn.execute(text(f"ALTER TABLE user_application_access ADD COLUMN permission_overrides {json_type} NOT NULL DEFAULT '{{}}'"))
    if 'project_names' not in columns:
        await conn.execute(text(f"ALTER TABLE user_application_access ADD COLUMN project_names {json_type} NOT NULL DEFAULT '[]'"))

    for index, (code, display_name) in enumerate(BOOKING_PERMISSION_NAMES.items()):
        permission_id = f'bookingreports:{code}'
        if not await conn.scalar(select(ApplicationPermission.id).where(ApplicationPermission.id == permission_id)):
            await conn.execute(ApplicationPermission.__table__.insert().values(
                id=permission_id, application_key='bookingreports', code=code,
                display_name=display_name, group_name=code.split(':', 1)[0].replace('_', ' ').title(),
                sort_order=index,
            ))
    for role_key, (display_name, permission_codes, sort_order) in BOOKING_ROLES.items():
        role_id = f'bookingreports:{role_key}'
        if not await conn.scalar(select(ApplicationRole.id).where(ApplicationRole.id == role_id)):
            await conn.execute(ApplicationRole.__table__.insert().values(
                id=role_id, application_key='bookingreports', key=role_key,
                display_name=display_name, sort_order=sort_order,
            ))
        for code in permission_codes:
            permission_id = f'bookingreports:{code}'
            exists = await conn.scalar(select(ApplicationRolePermission.role_id).where(
                ApplicationRolePermission.role_id == role_id,
                ApplicationRolePermission.permission_id == permission_id,
            ))
            if not exists:
                await conn.execute(ApplicationRolePermission.__table__.insert().values(
                    role_id=role_id, permission_id=permission_id,
                ))

    grants = (await conn.execute(
        select(
            UserApplicationAccess.user_id,
            UserApplicationAccess.role_id,
            UserApplicationAccess.permission_overrides,
            UserApplicationAccess.project_names,
            User.username,
        )
        .join(User, User.id == UserApplicationAccess.user_id)
        .where(UserApplicationAccess.application_key == 'bookingreports')
    )).all()
    for user_id, role_id, permission_overrides, project_names, username in grants:
        await conn.execute(
            UserApplicationAccess.__table__.update()
            .where(
                UserApplicationAccess.user_id == user_id,
                UserApplicationAccess.application_key == 'bookingreports',
            )
            .values(
                role_id=role_id or (
                    'bookingreports:admin' if username.lower() == 'admin' else 'bookingreports:sales'
                ),
                permission_overrides=permission_overrides or {},
                project_names=project_names or [],
            )
        )

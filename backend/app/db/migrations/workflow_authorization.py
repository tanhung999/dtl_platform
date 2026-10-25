"""Seed Workflows roles and permissions in the central registry."""

from sqlalchemy import select
from app.db.applications import ApplicationPermission, ApplicationRole, ApplicationRolePermission, UserApplicationAccess
from app.db.models import User

WORKFLOW_PERMISSIONS = [
    'document.assign', 'document.audit.export', 'document.cancel', 'document.claim',
    'document.complete', 'document.create', 'document.delete', 'document.forward',
    'document.receive_back', 'document.reject', 'document.resubmit', 'document.return',
    'document.submit', 'document.transfer', 'document.update', 'document.view.all',
    'document.view.department', 'document_undo', 'system.manage', 'workflow.manage',
]
WORKFLOW_ROLES = {
    'SYSTEM_ADMIN': ('Quản trị quy trình', WORKFLOW_PERMISSIONS, 10),
    'TRUONG_PHONG': ('Trưởng phòng', [
        'document.assign', 'document.cancel', 'document.claim', 'document.complete', 'document.create',
        'document.forward', 'document.reject', 'document.resubmit', 'document.return', 'document.submit',
        'document.transfer', 'document.update', 'document.view.department',
    ], 20),
    'USER': ('Người dùng', [
        'document.assign', 'document.audit.export', 'document.claim', 'document.complete', 'document.create',
        'document.forward', 'document.receive_back', 'document.reject', 'document.resubmit', 'document.return',
        'document.submit', 'document.transfer', 'document.update',
    ], 30),
}

async def migrate_workflow_authorization(conn) -> None:
    for order, code in enumerate(WORKFLOW_PERMISSIONS):
        permission_id = f'workflows:{code}'
        if not await conn.scalar(select(ApplicationPermission.id).where(ApplicationPermission.id == permission_id)):
            await conn.execute(ApplicationPermission.__table__.insert().values(
                id=permission_id, application_key='workflows', code=code,
                display_name=code.replace('.', ' › ').replace('_', ' ').title(),
                group_name='Hệ thống' if code.startswith(('system.', 'workflow.')) else 'Hồ sơ',
                sort_order=order,
            ))
    for role_key, (display_name, permission_codes, sort_order) in WORKFLOW_ROLES.items():
        role_id = f'workflows:{role_key}'
        if not await conn.scalar(select(ApplicationRole.id).where(ApplicationRole.id == role_id)):
            await conn.execute(ApplicationRole.__table__.insert().values(
                id=role_id, application_key='workflows', key=role_key,
                display_name=display_name, sort_order=sort_order,
            ))
        for code in permission_codes:
            permission_id = f'workflows:{code}'
            if not await conn.scalar(select(ApplicationRolePermission.role_id).where(
                ApplicationRolePermission.role_id == role_id,
                ApplicationRolePermission.permission_id == permission_id,
            )):
                await conn.execute(ApplicationRolePermission.__table__.insert().values(
                    role_id=role_id, permission_id=permission_id,
                ))
    grants = (await conn.execute(
        select(UserApplicationAccess.user_id, UserApplicationAccess.role_id, User.username)
        .join(User, User.id == UserApplicationAccess.user_id)
        .where(UserApplicationAccess.application_key == 'workflows')
    )).all()
    for user_id, role_id, username in grants:
        if not role_id:
            await conn.execute(UserApplicationAccess.__table__.update().where(
                UserApplicationAccess.user_id == user_id,
                UserApplicationAccess.application_key == 'workflows',
            ).values(role_id='workflows:SYSTEM_ADMIN' if username.lower() == 'admin' else 'workflows:USER'))

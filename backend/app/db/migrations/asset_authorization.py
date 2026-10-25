"""Seed Asset Manager roles and permissions in the central registry."""

import re
from sqlalchemy import select
from app.db.applications import ApplicationPermission, ApplicationRole, ApplicationRolePermission, UserApplicationAccess
from app.db.models import User

ASSET_PERMISSIONS = [
    'asset.approve','asset.create','asset.delete','asset.export','asset.override','asset.update','asset.view',
    'audit.export','audit.view','dashboard.unified.export','dashboard.unified.view','dashboard.view',
    'inventory.export','inventory.manage','inventory.view','it_asset.approve','it_asset.create','it_asset.delete',
    'it_asset.export','it_asset.update','it_asset.view','license.export','license.manage','license.secret.view',
    'license.view','onboarding.hc.manage','onboarding.hc.view','onboarding.it.mail','onboarding.it.view',
    'org.manage','permission.manage','role.manage','stationery.approve','stationery.create','stationery.delete',
    'stationery.export','stationery.import','stationery.issue','stationery.receive','stationery.report',
    'stationery.update','stationery.view','system.admin','user.create','user.delete','user.update','user.view',
]
ASSET_ROLES = {
    'Admin': [code for code in ASSET_PERMISSIONS if code in {
        'asset.approve','asset.create','asset.delete','asset.export','asset.update','asset.view','audit.export',
        'dashboard.unified.export','dashboard.view','inventory.export','inventory.manage','inventory.view',
        'it_asset.approve','it_asset.create','it_asset.delete','it_asset.export','it_asset.update','it_asset.view',
        'license.export','license.manage','license.view','onboarding.hc.manage','onboarding.hc.view','org.manage',
        'role.manage','user.create','user.delete','user.update','user.view'}],
    'IT Staff': ['onboarding.it.mail','onboarding.it.view'], 'Employee': [], 'Approver': [],
    'Chu tich': ['stationery.view'], 'Tong giam doc': ['stationery.view'],
    'Giam doc': ['stationery.view'], 'Truong phong': [], 'ViewerUser': [],
    'Administrator': ASSET_PERMISSIONS,
    'Tong_Giam_Doc': ['asset.view','audit.view','dashboard.unified.view','dashboard.view','inventory.view','it_asset.view','license.view','stationery.view'],
    'Pho_Tong_Giam_Doc': ['asset.view','audit.view','dashboard.unified.view','dashboard.view','inventory.view','it_asset.view','license.view'],
    'Ke_Toan': ['asset.view','audit.view','dashboard.unified.view','dashboard.view','inventory.view','it_asset.view','license.view','stationery.view'],
    'Truong_Phong_HC': ['asset.approve','asset.create','asset.delete','asset.export','asset.update','asset.view','dashboard.view','inventory.export','inventory.manage','inventory.view','onboarding.hc.manage','onboarding.hc.view','stationery.approve','stationery.create','stationery.delete','stationery.export','stationery.import','stationery.issue','stationery.receive','stationery.report','stationery.update','stationery.view'],
    'Nhan_Vien_HC': ['asset.create','asset.update','asset.view','dashboard.view','inventory.manage','inventory.view','onboarding.hc.manage','onboarding.hc.view','stationery.create','stationery.export','stationery.import','stationery.receive','stationery.update','stationery.view'],
    'Truong_Phong_IT': ['dashboard.view','it_asset.approve','it_asset.create','it_asset.delete','it_asset.export','it_asset.update','it_asset.view','license.export','license.manage','license.view','onboarding.it.mail','onboarding.it.view'],
    'Nhan_Vien_IT': ['dashboard.view','it_asset.create','it_asset.update','it_asset.view','license.manage','license.view','onboarding.it.mail','onboarding.it.view'],
}

def _role_id(name: str) -> str:
    return 'itam:' + re.sub(r'[^a-z0-9_]+', '-', name.lower()).strip('-')

async def migrate_asset_authorization(conn) -> None:
    for order, code in enumerate(ASSET_PERMISSIONS):
        permission_id = f'itam:{code}'
        if not await conn.scalar(select(ApplicationPermission.id).where(ApplicationPermission.id == permission_id)):
            await conn.execute(ApplicationPermission.__table__.insert().values(
                id=permission_id, application_key='itam', code=code,
                display_name=code.replace('.', ' › ').replace('_', ' ').title(),
                group_name=code.split('.', 1)[0].replace('_', ' ').title(), sort_order=order,
            ))
    for order, (role_key, codes) in enumerate(ASSET_ROLES.items()):
        role_id = await conn.scalar(select(ApplicationRole.id).where(
            ApplicationRole.application_key == 'itam',
            ApplicationRole.key == role_key,
        ))
        if not role_id:
            role_id = _role_id(role_key)
            await conn.execute(ApplicationRole.__table__.insert().values(
                id=role_id, application_key='itam', key=role_key,
                display_name=role_key.replace('_', ' '), sort_order=order,
            ))
        await conn.execute(ApplicationRolePermission.__table__.delete().where(
            ApplicationRolePermission.role_id == role_id,
        ))
        for code in codes:
            permission_id = f'itam:{code}'
            await conn.execute(ApplicationRolePermission.__table__.insert().values(role_id=role_id, permission_id=permission_id))
    grants = (await conn.execute(select(
        UserApplicationAccess.user_id, UserApplicationAccess.role_id, User.username,
    ).join(User, User.id == UserApplicationAccess.user_id).where(
        UserApplicationAccess.application_key == 'itam'))).all()
    for user_id, role_id, username in grants:
        if not role_id:
            target_key = 'Administrator' if username.lower() == 'admin' else 'Employee'
            target_role_id = await conn.scalar(select(ApplicationRole.id).where(
                ApplicationRole.application_key == 'itam',
                ApplicationRole.key == target_key,
            ))
            await conn.execute(UserApplicationAccess.__table__.update().where(
                UserApplicationAccess.user_id == user_id,
                UserApplicationAccess.application_key == 'itam',
            ).values(role_id=target_role_id))

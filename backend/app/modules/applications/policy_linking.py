"""Import existing rights before allowing Platform to become their authority.

The destination records operation_id before responding. Its authorization layer
rejects a mismatched Platform operation_id, including during a lost response or
Platform rollback. Retrying the same operation recovers the original snapshot.
"""
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.db.applications import Application, ApplicationPolicyOwnership, ApplicationRole, ApplicationPermission, UserApplicationAccess
from app.db.models import User, utcnow
from app.db.access import AccessAuditLog
from app.modules.access.audit import record
from app.modules.access.service import MANAGE, require
from app.modules.auth.dependencies import get_current_user
from .account_linking import configuration

router = APIRouter(prefix='/api/admin/applications', tags=['Application policy handover'])
Database = Annotated[AsyncSession, Depends(get_db, scope='function')]
CurrentUser = Annotated[User, Depends(get_current_user)]


def integration(application):
    if application == 'workflows':
        return configuration(), settings.WORKFLOWS_ACCOUNT_LINKING_SECRET
    prefix = {'itam': 'ASSETS', 'bookingreports': 'BOOKINGREPORTS'}.get(application)
    if not prefix:
        raise HTTPException(404, 'Ứng dụng không hỗ trợ liên kết tài khoản.')
    from urllib.parse import urlsplit
    base = getattr(settings, prefix + '_ACCOUNT_LINKING_URL').rstrip('/')
    secret = getattr(settings, prefix + '_ACCOUNT_LINKING_SECRET')
    try:
        url = urlsplit(base)
        url.port
        valid = url.scheme in ('http', 'https') and url.hostname and not any((url.username, url.password, url.query, url.fragment))
    except ValueError:
        valid = False
    return (base if valid and len(secret) >= 32 else None), secret


async def remote(application, method, path, *, params=None, body=None):
    base, secret = integration(application)
    if not base:
        raise HTTPException(503, 'Chưa cấu hình tích hợp liên kết và nhập quyền cho ứng dụng này.')
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8, connect=2), follow_redirects=False, trust_env=False) as client:
            result = await client.request(method, base + path, params=params, json=body, headers={'X-DTL-Linking-Secret': secret})
        if result.status_code in (404, 409, 422):
            detail = result.json().get('detail')
            raise HTTPException(result.status_code, detail[:400] if isinstance(detail, str) else 'Thông tin tài khoản vừa thay đổi. Hãy tải lại.')
        if result.status_code != 200:
            raise HTTPException(503, 'Tích hợp nhập quyền chưa sẵn sàng. Chưa xác nhận hoàn tất liên kết.')
        value = result.json()
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except httpx.TransportError:
        raise HTTPException(503, 'Chưa xác nhận hoàn tất liên kết. Hãy thử lại cùng thao tác; không chọn tài khoản khác.') from None
    except ValueError:
        raise HTTPException(502, 'Ứng dụng trả về dữ liệu liên kết chưa hợp lệ.') from None


async def context(db, actor, application_key, target_id, *, lock=False):
    await require(db, actor.id, MANAGE)
    target = await db.scalar(select(User).where(User.id == target_id).with_for_update())
    app = await db.get(Application, application_key)
    grant = await db.get(UserApplicationAccess, (target_id, application_key), with_for_update=lock, populate_existing=lock)
    if not target or not app:
        raise HTTPException(404, 'Không tìm thấy tài khoản hoặc ứng dụng.')
    if not target.is_active or not app.is_active:
        raise HTTPException(409, 'Tài khoản và ứng dụng phải đang hoạt động để liên kết.')
    if grant is None:
        grant = UserApplicationAccess(user_id=target.id, application_key=application_key,
            enabled=False, permission_overrides={}, project_names=[], granted_by_id=actor.id)
        db.add(grant)
        await db.flush()
    if not target.identity_subject or target.identity_subject.startswith('platform:'):
        raise HTTPException(409, 'Tài khoản chưa có định danh SSO hiện tại.')
    return target, grant


class ConfirmInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    operation_id: UUID
    external_user_id: str = Field(min_length=1, max_length=100)
    expected_revision: str = Field(min_length=64, max_length=64, pattern='^[0-9a-f]+$')
    expected_platform_subject: str = Field(min_length=1, max_length=255)
    expected_grant_updated_at: str = Field(min_length=1, max_length=64)


@router.get('/{application_key}/users/{target_id}/policy-link/candidates')
async def candidates(application_key: str, target_id: str, user: CurrentUser, db: Database, response: Response,
                     q: str = Query(default='', max_length=100), offset: int = Query(default=0, ge=0, le=100000)):
    response.headers['Cache-Control'] = 'no-store'
    target, grant = await context(db, user, application_key, target_id)
    result = await remote(application_key, 'GET', '/policy-candidates', params={
        'subject': target.identity_subject, 'platform_user_id': target.id, 'q': q, 'offset': offset})
    if not isinstance(result.get('items'), list):
        raise HTTPException(502, 'Danh sách tài khoản chưa hợp lệ.')
    return {**result, 'platform_subject': target.identity_subject, 'grant_updated_at': grant.updated_at.isoformat()}


async def import_snapshot(db, grant, snapshot, target, application_key, operation):
    """Validate all rights before touching the central grant. Never update shared role definitions."""
    try:
        roles = snapshot['role_keys']; codes = snapshot['permission_keys']; projects = snapshot['project_names']
        catalog = snapshot['catalog_permission_keys']
        if (not all(isinstance(values, list) and len(values) <= 2000 and all(isinstance(x, str) and x and len(x) <= 500 for x in values)
                    for values in (roles, codes, projects, catalog)) or not set(codes) <= set(catalog)):
            raise ValueError()
    except (KeyError, ValueError, TypeError):
        raise HTTPException(502, 'Chưa nhận đủ quyền thực tế từ ứng dụng. Không thay đổi quyền trên Platform.') from None
    known_roles = {r.key: r for r in (await db.scalars(select(ApplicationRole).where(ApplicationRole.application_key == application_key))).all()}
    known_permissions = set((await db.scalars(select(ApplicationPermission.code).where(ApplicationPermission.application_key == application_key))).all())
    if set(roles) - known_roles.keys() or set(codes) - known_permissions:
        raise HTTPException(409, 'Danh mục vai trò hoặc quyền trên Platform chưa đầy đủ. Hãy đồng bộ danh mục trước khi liên kết.')
    ownership = await db.get(ApplicationPolicyOwnership, (target.id, application_key))
    if ownership is None:
        ownership = ApplicationPolicyOwnership(user_id=target.id, application_key=application_key)
        db.add(ownership)
    ownership.operation_id = operation
    ownership.external_user_id = str(snapshot['account']['id'])
    ownership.role_keys = sorted(set(roles))
    ownership.imported_snapshot = snapshot
    grant.role_id = known_roles[roles[0]].id if roles else None
    # Pin both allowed and denied rights, including differences in role catalogs.
    grant.permission_overrides = {code: code in codes for code in known_permissions}
    grant.project_names = sorted(set(projects))
    grant.updated_at = utcnow()
    from app.db.applications import ApplicationProvisioningPolicy
    creation = await db.get(ApplicationProvisioningPolicy, (target.id, application_key), with_for_update=True)
    if creation:
        creation.enabled = False
        creation.generation = max(creation.generation, creation.pending_generation or 0)
        creation.pending_enabled = None; creation.pending_generation = None; creation.version += 1
    await db.flush()


@router.post('/{application_key}/users/{target_id}/policy-link')
async def confirm(application_key: str, target_id: str, payload: ConfirmInput, user: CurrentUser, db: Database, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    target, grant = await context(db, user, application_key, target_id, lock=True)
    from app.db.applications import ApplicationProvisioningPolicy
    creation = await db.get(ApplicationProvisioningPolicy, (target_id, application_key), with_for_update=True)
    if creation and creation.unlink_operation_id:
        raise HTTPException(409, 'Hãy hoàn tất thao tác hủy liên kết đang xử lý trước.')
    reused = await db.scalar(select(ApplicationPolicyOwnership).where(ApplicationPolicyOwnership.operation_id == str(payload.operation_id)))
    if reused and (reused.user_id != target_id or reused.application_key != application_key):
        raise HTTPException(409, 'Mã thao tác đã được sử dụng cho tài khoản hoặc ứng dụng khác.')
    ownership = await db.get(ApplicationPolicyOwnership, (target_id, application_key))
    if ownership and ownership.operation_id == str(payload.operation_id):
        audit = await db.scalar(select(AccessAuditLog).where(AccessAuditLog.action == 'application_policy_imported',
            AccessAuditLog.subject_id == target_id, AccessAuditLog.changes['operation_id'].as_string() == str(payload.operation_id)))
        if (ownership.external_user_id != payload.external_user_id or target.identity_subject != payload.expected_platform_subject
                or ownership.imported_snapshot.get('revision') != payload.expected_revision or not audit or audit.actor_id != user.id):
            raise HTTPException(409, 'Mã thao tác đã được sử dụng cho tài khoản khác.')
        return {'linked': True, 'changed': False}
    if target.identity_subject != payload.expected_platform_subject or grant.updated_at.isoformat() != payload.expected_grant_updated_at:
        raise HTTPException(409, 'Định danh hoặc quyền trên Platform vừa thay đổi. Hãy tải lại trước khi liên kết.')
    result = await remote(application_key, 'POST', '/policy-import', body={
        'operation_id': str(payload.operation_id), 'external_user_id': payload.external_user_id,
        'expected_revision': payload.expected_revision, 'identity_subject': target.identity_subject,
        'platform_user_id': target.id, 'actor_id': user.id, 'actor_username': user.username})
    snapshot = result.get('snapshot')
    if (result.get('operation_id') != str(payload.operation_id) or not isinstance(snapshot, dict)
            or str(snapshot.get('account', {}).get('id')) != payload.external_user_id
            or result.get('identity_subject') != target.identity_subject or snapshot.get('revision') != payload.expected_revision):
        raise HTTPException(502, 'Chưa xác nhận đúng tài khoản liên kết. Hãy thử lại cùng thao tác.')
    await import_snapshot(db, grant, snapshot, target, application_key, str(payload.operation_id))
    record(db, user, target, 'application_policy_imported', {'application': application_key,
        'operation_id': str(payload.operation_id), 'external_user_id': payload.external_user_id,
        'role_keys': snapshot['role_keys'], 'permission_keys': snapshot['permission_keys'], 'project_names': snapshot['project_names']})
    return {'linked': True, 'changed': True}

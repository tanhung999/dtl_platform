"""Admin UI bridge. Only this configured integration can link Workflow accounts."""
from typing import Annotated
from urllib.parse import urlsplit
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.db.access import AccessAuditLog
from app.db.applications import Application, UserApplicationAccess
from app.db.models import User
from app.modules.access.audit import record
from app.modules.access.service import APPLICATIONS_MANAGE, require
from app.modules.applications.router import _access_view
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/admin/applications/workflows/users", tags=["Account linking"])
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]
CurrentUser = Annotated[User, Depends(get_current_user)]


def configuration():
    base = settings.WORKFLOWS_ACCOUNT_LINKING_URL.rstrip("/")
    try:
        parsed = urlsplit(base)
        parsed.port
    except ValueError:
        return None
    if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or len(settings.WORKFLOWS_ACCOUNT_LINKING_SECRET) < 32):
        return None
    return base


async def workflow_request(method, path, *, params=None, body=None):
    base = configuration()
    if base is None:
        raise HTTPException(503, "Chưa bật tích hợp liên kết tài khoản Workflow.")
    attempts = 2 if method == "POST" else 1
    for attempt in range(attempts):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(5, connect=2), follow_redirects=False, trust_env=False) as client:
                result = await client.request(method, base + path, params=params, json=body,
                    headers={"X-DTL-Linking-Secret": settings.WORKFLOWS_ACCOUNT_LINKING_SECRET})
            if result.status_code in (404, 409, 422):
                detail = result.json().get("detail")
                raise HTTPException(result.status_code, detail[:400] if isinstance(detail, str) else "Thông tin liên kết đã thay đổi. Hãy tải lại và kiểm tra.")
            if result.status_code != 200:
                raise HTTPException(503, "Tích hợp liên kết Workflow chưa sẵn sàng. Vui lòng liên hệ quản trị viên.")
            value = result.json()
            if not isinstance(value, dict):
                raise ValueError("Unexpected response")
            return value
        except httpx.TransportError:
            if attempt + 1 < attempts:
                continue
            raise HTTPException(503, "Chưa xác nhận được kết quả từ Workflow. Hãy thử lại cùng thao tác để kiểm tra, không chọn tài khoản khác.") from None
        except (ValueError, KeyError):
            raise HTTPException(502, "Workflow trả về thông tin chưa hợp lệ. Vui lòng liên hệ quản trị viên.") from None


async def context(db, actor, target_id, *, lock=False):
    await require(db, actor.id, APPLICATIONS_MANAGE)
    query = select(User).where(User.id == target_id)
    target = await db.scalar(query.with_for_update() if lock else query)
    if target is None:
        raise HTTPException(404, "Không tìm thấy tài khoản Platform.")
    application = await db.get(Application, "workflows")
    grant = await db.get(UserApplicationAccess, (target_id, "workflows"), with_for_update=lock)
    reason = ("Tài khoản Platform đang bị khóa." if not target.is_active else
              "Tài khoản Platform chưa có định danh SSO hiện tại. Hãy hoàn tất liên kết Keycloak." if not target.identity_subject or target.identity_subject.startswith("platform:") else
              "DT Workflow chưa được bật trên Platform." if not application or not application.is_active else
              "Hãy cấp quyền mở DT Workflow cho tài khoản này trước khi liên kết." if not grant or not grant.enabled else None)
    policy = await _access_view(db, application, grant) if application else None
    return target, grant, reason, policy


def params_for(target):
    return {"subject": target.identity_subject, "platform_user_id": target.id}


def policy_view(policy):
    return {"role_key": policy.role_key, "role_name": policy.role_display_name, "permission_keys": policy.permission_keys} if policy else None


@router.get("/{target_id}/account-link")
async def state(target_id: str, user: CurrentUser, db: Database, response: Response):
    response.headers["Cache-Control"] = "no-store"
    target, grant, reason, policy = await context(db, user, target_id)
    configured = configuration() is not None
    # Existing links must remain visible/removable after access is revoked or a user is locked.
    has_subject = bool(target.identity_subject and not target.identity_subject.startswith("platform:"))
    remote = await workflow_request("GET", "/status", params=params_for(target)) if configured and has_subject else {}
    if remote and not all(isinstance(remote.get(key), list) for key in ("accounts", "roles", "permission_keys")):
        raise HTTPException(502, "Thông tin tích hợp Workflow chưa hợp lệ.")
    return {"configured": configured, "blocked_reason": reason if configured else "Chưa bật tích hợp liên kết tài khoản Workflow.",
            "platform_account": {"id": target.id, "username": target.username, "full_name": target.full_name, "email": target.email,
                                 "identity_subject": target.identity_subject},
            "grant_updated_at": grant.updated_at.isoformat() if grant else None,
            "auto_link_blocked": remote.get("auto_link_blocked", False),
            "policy": policy_view(policy), "accounts": remote.get("accounts", []), "roles": remote.get("roles", []),
            "permission_keys": remote.get("permission_keys", []), "history": remote.get("history", [])}


@router.get("/{target_id}/account-link/candidates")
async def candidates(target_id: str, user: CurrentUser, db: Database, response: Response,
                     q: str = Query(default="", max_length=100), offset: int = Query(default=0, ge=0, le=100000)):
    response.headers["Cache-Control"] = "no-store"
    target, _, reason, _ = await context(db, user, target_id)
    if reason:
        raise HTTPException(409, reason)
    result = await workflow_request("GET", "/accounts", params={**params_for(target), "q": q, "offset": offset})
    if not isinstance(result.get("items"), list) or not isinstance(result.get("total"), int):
        raise HTTPException(502, "Danh sách tài khoản Workflow chưa hợp lệ.")
    return result


class LinkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    workflow_user_id: UUID
    expected_subject: str | None = Field(max_length=255)
    expected_updated_at: str = Field(min_length=1, max_length=64)
    expected_platform_subject: str = Field(min_length=1, max_length=255)
    expected_grant_updated_at: str = Field(min_length=1, max_length=64)


class UnlinkInput(LinkInput):
    expected_subject: str = Field(min_length=1, max_length=255)
    expected_grant_updated_at: str | None = Field(max_length=64)
    revoke_access: bool = True


@router.post("/{target_id}/account-link/unlink")
async def unlink(target_id: str, payload: UnlinkInput, user: CurrentUser, db: Database, response: Response):
    response.headers["Cache-Control"] = "no-store"
    target, grant, _, _ = await context(db, user, target_id, lock=True)
    if not target.identity_subject or target.identity_subject.startswith("platform:") or target.identity_subject != payload.expected_platform_subject:
        raise HTTPException(409, "Định danh Platform vừa thay đổi. Hãy tải lại trước khi hủy liên kết.")
    audit = await db.scalar(select(AccessAuditLog).where(
        AccessAuditLog.action == "application_account_unlinked", AccessAuditLog.subject_id == target.id,
        AccessAuditLog.changes["operation_id"].as_string() == str(payload.operation_id)))
    if audit:
        if (audit.actor_id != user.id or audit.changes.get("revoke_access") != payload.revoke_access
                or audit.changes.get("after", {}).get("workflow_user_id") != str(payload.workflow_user_id)
                or audit.changes.get("before", {}).get("identity_subject") != payload.expected_subject):
            raise HTTPException(409, "Mã thao tác đã được sử dụng cho yêu cầu khác.")
    elif (grant.updated_at.isoformat() if grant else None) != payload.expected_grant_updated_at:
        raise HTTPException(409, "Quyền ứng dụng vừa thay đổi. Hãy tải lại trước khi hủy liên kết.")
    result = await workflow_request("POST", "/unlink", body={
        "operation_id": str(payload.operation_id), "workflow_user_id": str(payload.workflow_user_id),
        "platform_user_id": target.id, "identity_subject": target.identity_subject,
        "expected_subject": payload.expected_subject, "expected_updated_at": payload.expected_updated_at,
        "actor_id": user.id, "actor_username": user.username,
    })
    account = result.get("account")
    if (not isinstance(account, dict) or account.get("id") != str(payload.workflow_user_id)
            or account.get("identity_subject") is not None or "identity_subject" not in account
            or result.get("operation_id") != str(payload.operation_id)
            or not isinstance(account.get("username"), str) or not account["username"]):
        raise HTTPException(502, "Chưa xác nhận được kết quả hủy liên kết. Hãy kiểm tra lại cùng thao tác.")
    # Workflow commits its SSO block first. A lost response cannot silently restore SSO access.
    # A replay must not revoke an application grant another administrator has since re-enabled.
    if not audit:
        before_enabled = bool(grant and grant.enabled)
        if payload.revoke_access and grant:
            grant.enabled = False
        record(db, user, target, "application_account_unlinked", {
            "operation_id": str(payload.operation_id), "application": "workflows", "revoke_access": payload.revoke_access,
            "before": {"identity_subject": payload.expected_subject, "enabled": before_enabled},
            "after": {"workflow_user_id": account["id"], "workflow_username": account["username"],
                      "identity_subject": None, "enabled": bool(grant and grant.enabled),
                      "revoked_sessions": result.get("revoked_sessions", 0)},
        })
        await db.flush()
    return {**result, "access_revoked": not bool(grant and grant.enabled)}


@router.post("/{target_id}/account-link")
async def link(target_id: str, payload: LinkInput, user: CurrentUser, db: Database, response: Response):
    response.headers["Cache-Control"] = "no-store"
    target, grant, reason, policy = await context(db, user, target_id, lock=True)
    if reason:
        raise HTTPException(409, reason)
    if target.identity_subject != payload.expected_platform_subject or grant.updated_at.isoformat() != payload.expected_grant_updated_at:
        raise HTTPException(409, "Định danh hoặc quyền trên Platform vừa thay đổi. Hãy tải lại trước khi liên kết.")
    result = await workflow_request("POST", "", body={
        "operation_id": str(payload.operation_id), "workflow_user_id": str(payload.workflow_user_id),
        "platform_user_id": target.id, "identity_subject": target.identity_subject,
        "expected_subject": payload.expected_subject, "expected_updated_at": payload.expected_updated_at,
        "actor_id": user.id, "actor_username": user.username,
        "role_key": policy.role_key, "permission_keys": policy.permission_keys,
    })
    account = result.get("account")
    if (not isinstance(account, dict) or account.get("id") != str(payload.workflow_user_id)
            or account.get("identity_subject") != target.identity_subject or result.get("operation_id") != str(payload.operation_id)
            or not isinstance(account.get("username"), str) or not account["username"]):
        raise HTTPException(502, "Chưa xác nhận được tài khoản đã liên kết. Hãy kiểm tra lại trạng thái.")
    audit_exists = await db.scalar(select(AccessAuditLog.id).where(
        AccessAuditLog.action == "application_account_linked", AccessAuditLog.subject_id == target.id,
        AccessAuditLog.changes["operation_id"].as_string() == str(payload.operation_id)))
    if not audit_exists:
        record(db, user, target, "application_account_linked", {
            "operation_id": str(payload.operation_id), "application": "workflows",
            "before": {"identity_subject": payload.expected_subject},
            "after": {"workflow_user_id": account["id"], "workflow_username": account["username"],
                      "identity_subject": target.identity_subject, "revoked_sessions": result.get("revoked_sessions", 0)},
        })
        await db.flush()
    return result

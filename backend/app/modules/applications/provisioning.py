"""Per-user creation consent, durable intents and generation-checked destination RPCs."""

from typing import Annotated
from uuid import UUID, uuid5

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.db.applications import (
    Application,
    UserApplicationAccess,
    ApplicationProvisioningPolicy,
    ApplicationPolicyOwnership,
)
from app.db.models import User
from app.modules.access.service import MANAGE, require
from app.modules.access.audit import record
from app.modules.auth.dependencies import get_current_user
from .integration import _authorize, check_subject_entitlement
from .policy_linking import integration, remote, import_snapshot
from .router import _access_view

router = APIRouter(tags=["Per-user account creation"])
Database = Annotated[AsyncSession, Depends(get_db, scope="function")]
CurrentUser = Annotated[User, Depends(get_current_user)]
NAMESPACE = UUID("cdd2f7f4-6990-419b-90c4-d9de8ca324bb")


def operation_for(user_id, application, subject, generation):
    return str(uuid5(NAMESPACE, f"{application}:{user_id}:{subject}:{generation}"))


async def rows(db, application, target_id, *, lock=False):
    target = await db.get(User, target_id, with_for_update=lock, populate_existing=True)
    app = await db.get(Application, application)
    if target is None or app is None:
        raise HTTPException(404, "Không tìm thấy tài khoản hoặc ứng dụng.")
    grant = await db.get(
        UserApplicationAccess,
        (target_id, application),
        with_for_update=lock,
        populate_existing=True,
    )
    policy = await db.get(
        ApplicationProvisioningPolicy,
        (target_id, application),
        with_for_update=lock,
        populate_existing=True,
    )
    return target, app, grant, policy


def require_access(target, app, grant):
    if not target.is_active or not app.is_active or not grant or not grant.enabled:
        raise HTTPException(
            409, "Tài khoản phải hoạt động và được cấp quyền mở ứng dụng."
        )
    if not target.identity_subject or target.identity_subject.startswith("platform:"):
        raise HTTPException(409, "Tài khoản chưa có định danh SSO hiện tại.")


def identity(target):
    return {
        "identity_subject": target.identity_subject,
        "platform_user_id": target.id,
        "username": target.username,
        "email": target.email or "",
        "full_name": target.full_name,
        "department": target.department or "",
    }


async def destination_status(application, target):
    return await remote(
        application, "GET", "/provisioning/status", params=identity(target)
    )


async def adopt_created(db, target, application, grant, policy, result):
    owner = await db.get(ApplicationPolicyOwnership, (target.id, application))
    snapshot = result.get("snapshot")
    expected = (
        operation_for(
            target.id, application, target.identity_subject, policy.generation
        )
        if policy
        else None
    )
    if (
        owner is None
        and policy
        and policy.identity_subject == target.identity_subject
        and result.get("provisioned_operation_id") == expected
        and isinstance(snapshot, dict)
    ):
        await import_snapshot(db, grant, snapshot, target, application, expected)
        policy.enabled = False
        record(
            db,
            target,
            target,
            "application_account_provisioned",
            {
                "application": application,
                "source": "sso",
                "operation_id": expected,
                "external_user_id": str(snapshot["account"]["id"]),
            },
        )
        return True
    return owner is not None


def view(policy, result, *, configured=True, managed=False):
    state = result.get("state", "unavailable")
    return {
        "configured": configured,
        "state": state,
        "account": result.get("account"),
        "managed_by_platform": managed,
        "enabled": bool(policy and policy.enabled),
        "version": policy.version if policy else 0,
        "pending_enabled": policy.pending_enabled if policy else None,
        "blocked_reason": result.get("blocked_reason"),
        "can_enable": state == "unlinked" and not result.get("collision"),
        "collision": bool(result.get("collision")),
        "revision": (result.get("snapshot") or {}).get("revision"),
        "pending_unlink": {
            key: policy.unlink_payload[key]
            for key in ("operation_id", "external_user_id", "expected_revision")
        }
        if policy and policy.unlink_operation_id
        else None,
    }


@router.get("/api/admin/applications/{application}/users/{target_id}/provisioning")
async def status(
    application: str,
    target_id: str,
    user: CurrentUser,
    db: Database,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    await require(db, user.id, MANAGE)
    target, app, grant, policy = await rows(db, application, target_id)
    if integration(application)[0] is None:
        return view(
            policy,
            {
                "state": "unavailable",
                "blocked_reason": "Chưa cấu hình tích hợp tài khoản với ứng dụng này.",
            },
            configured=False,
        )
    if not target.identity_subject or target.identity_subject.startswith("platform:"):
        return view(
            policy,
            {
                "state": "unavailable",
                "blocked_reason": "Tài khoản chưa có định danh SSO hiện tại.",
            },
        )
    result = await destination_status(application, target)
    # Recover a completed destination create after a lost central commit/response.
    managed = bool(await db.get(ApplicationPolicyOwnership, (target.id, application)))
    if grant and result.get("state") == "linked" and not managed:
        checked_subject = target.identity_subject
        target, app, grant, policy = await rows(db, application, target_id, lock=True)
        if target.identity_subject != checked_subject:
            raise HTTPException(409, "Định danh vừa thay đổi. Hãy tải lại.")
        managed = await adopt_created(db, target, application, grant, policy, result)
    output = view(policy, result, managed=managed)
    output["can_enable"] = output["can_enable"] and bool(
        target.is_active and app.is_active and grant and grant.enabled
    )
    return output


class ConsentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    expected_version: int = Field(ge=0)


@router.put("/api/admin/applications/{application}/users/{target_id}/provisioning")
async def consent(
    application: str,
    target_id: str,
    payload: ConsentInput,
    user: CurrentUser,
    db: Database,
    response: Response,
):
    response.headers["Cache-Control"] = "no-store"
    await require(db, user.id, MANAGE)
    target, app, grant, policy = await rows(db, application, target_id, lock=True)
    if payload.enabled:
        require_access(target, app, grant)
    if not target.identity_subject or target.identity_subject.startswith("platform:"):
        raise HTTPException(409, "Tài khoản chưa có định danh SSO hiện tại.")
    if policy is None:
        policy = ApplicationProvisioningPolicy(
            user_id=target_id,
            application_key=application,
            enabled=False,
            generation=0,
            version=0,
        )
        db.add(policy)
    if policy.version != payload.expected_version:
        raise HTTPException(
            409, "Trạng thái tự tạo vừa thay đổi. Hãy tải lại trước khi lưu."
        )
    if policy.unlink_operation_id:
        raise HTTPException(409, "Hãy hoàn tất thao tác hủy liên kết đang xử lý trước.")
    if await db.get(ApplicationPolicyOwnership, (target_id, application)):
        raise HTTPException(
            409, "Tài khoản đã liên kết. Dùng Hủy liên kết nếu muốn ngắt kết nối."
        )
    if (
        policy.pending_enabled is None
        or policy.pending_enabled != payload.enabled
        or policy.identity_subject != target.identity_subject
    ):
        policy.pending_generation = (
            max(policy.generation, policy.pending_generation or 0) + 1
        )
        policy.pending_enabled = payload.enabled
        policy.identity_subject = target.identity_subject
        policy.version += 1
        record(
            db,
            user,
            target,
            "application_provisioning_requested",
            {"application": application, "enabled": payload.enabled},
        )
    generation, subject = policy.pending_generation, target.identity_subject
    # Persist the intent before contacting the destination. A reload can retry it.
    await db.commit()
    result = await remote(
        application,
        "POST",
        "/provisioning/permission",
        body={
            **identity(target),
            "enabled": payload.enabled,
            "generation": generation,
            "actor_id": user.id,
            "actor_username": user.username,
        },
    )
    target, app, grant, policy = await rows(db, application, target_id, lock=True)
    if policy.pending_generation != generation or target.identity_subject != subject:
        raise HTTPException(
            409, "Một thay đổi mới hơn đang được xử lý. Hãy tải lại trạng thái."
        )
    managed = False
    if result.get("state") == "linked" and grant:
        managed = await adopt_created(db, target, application, grant, policy, result)
    if result.get("generation") != generation:
        raise HTTPException(
            502, "Chưa xác nhận được phiên bản quyền tự tạo tại ứng dụng đích."
        )
    policy.enabled = bool(
        payload.enabled
        and result.get("state") == "unlinked"
        and not result.get("collision")
        and target.is_active
        and app.is_active
        and grant
        and grant.enabled
    )
    policy.generation = generation
    policy.pending_generation = None
    policy.pending_enabled = None
    policy.version += 1
    record(
        db,
        user,
        target,
        "application_provisioning_updated",
        {"application": application, "enabled": policy.enabled},
    )
    await db.flush()
    return view(policy, result, managed=managed)


@router.post(
    "/api/integrations/applications/{application}/subjects/{subject}/provision"
)
async def provision(
    application: str,
    subject: str,
    db: Database,
    response: Response,
    secret: Annotated[str | None, Header(alias="X-DTL-Integration-Secret")] = None,
):
    response.headers["Cache-Control"] = "no-store"
    _authorize(application, secret)
    target_id = await db.scalar(select(User.id).where(User.identity_subject == subject))
    if not target_id or subject.startswith("platform:"):
        raise HTTPException(403, "Không có quyền tạo tài khoản cho định danh này.")
    target, app, grant, policy = await rows(db, application, target_id, lock=True)
    require_access(target, app, grant)
    owner = await db.get(ApplicationPolicyOwnership, (target_id, application))
    if policy and policy.unlink_operation_id:
        raise HTTPException(403, "Liên kết đang được hủy. Không tạo hoặc mở phiên mới.")
    if owner:
        return {
            "entitlement": (
                await check_subject_entitlement(application, subject, db, secret)
            ).model_dump()
        }
    if (
        not policy
        or not policy.enabled
        or policy.pending_enabled is not None
        or policy.identity_subject != subject
    ):
        raise HTTPException(
            403,
            "Chưa được cho phép tạo tài khoản tại ứng dụng này. Vui lòng liên hệ quản trị viên.",
        )
    result = await destination_status(application, target)
    operation = operation_for(target.id, application, subject, policy.generation)
    if result.get("state") == "linked":
        if result.get("provisioned_operation_id") != operation:
            raise HTTPException(
                409, "Đã có tài khoản đích. Hãy xác nhận liên kết thay vì tạo mới."
            )
    else:
        if result.get("state") != "unlinked" or result.get("collision"):
            raise HTTPException(
                409, "Đã có tài khoản liên quan. Hãy liên kết tài khoản có sẵn."
            )
        current = await _access_view(db, app, grant)
        if not set(current.role_keys) <= set(result.get("role_keys", [])) or not set(
            current.permission_keys
        ) <= set(result.get("permission_keys", [])):
            raise HTTPException(
                409, "Danh mục quyền giữa hai ứng dụng chưa khớp. Chưa tạo tài khoản."
            )
        result = await remote(
            application,
            "POST",
            "/provisioning/create",
            body={
                **identity(target),
                "generation": policy.generation,
                "operation_id": operation,
                "role_key": current.role_key,
                "role_keys": current.role_keys,
                "permission_keys": current.permission_keys,
                "project_names": current.project_names,
            },
        )
    if (
        result.get("provisioned_operation_id") != operation
        or result.get("state") != "linked"
    ):
        raise HTTPException(
            502, "Chưa xác nhận được tài khoản đã tạo. Hãy thử đăng nhập lại."
        )
    await adopt_created(db, target, application, grant, policy, result)
    policy.enabled = False
    policy.version += 1
    await db.flush()
    return {
        "entitlement": (
            await check_subject_entitlement(application, subject, db, secret)
        ).model_dump()
    }


class UnlinkInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: UUID
    external_user_id: str = Field(min_length=1, max_length=100)
    expected_revision: str = Field(pattern="^[0-9a-f]{64}$")
    expected_version: int = Field(ge=0)


@router.post(
    "/api/admin/applications/{application}/users/{target_id}/provisioning/unlink"
)
async def unlink(
    application: str,
    target_id: str,
    payload: UnlinkInput,
    user: CurrentUser,
    db: Database,
):
    await require(db, user.id, MANAGE)
    target, app, grant, policy = await rows(db, application, target_id, lock=True)
    if policy is None:
        policy = ApplicationProvisioningPolicy(
            user_id=target_id,
            application_key=application,
            enabled=False,
            generation=0,
            version=0,
        )
        db.add(policy)
    operation = str(payload.operation_id)
    if policy.unlink_operation_id:
        if policy.unlink_operation_id != operation:
            raise HTTPException(409, "Hãy hoàn tất thao tác hủy liên kết đang xử lý.")
        body = policy.unlink_payload
    else:
        if policy.version != payload.expected_version:
            raise HTTPException(
                409, "Liên kết vừa thay đổi. Hãy tải lại trước khi hủy."
            )
        result = await destination_status(application, target)
        if (
            result.get("state") not in ("linked", "legacy")
            or str((result.get("account") or {}).get("id")) != payload.external_user_id
            or (result.get("snapshot") or {}).get("revision")
            != payload.expected_revision
        ):
            raise HTTPException(
                409, "Tài khoản hoặc quyền vừa thay đổi. Hãy tải lại trước khi hủy."
            )
        body = {
            **identity(target),
            "operation_id": operation,
            "external_user_id": payload.external_user_id,
            "expected_revision": payload.expected_revision,
            "generation": max(policy.generation, policy.pending_generation or 0) + 1,
            "actor_id": user.id,
            "actor_username": user.username,
        }
        policy.unlink_operation_id = operation
        policy.unlink_payload = body
        policy.enabled = False
        policy.version += 1
        record(
            db,
            user,
            target,
            "application_unlink_requested",
            {"application": application, "operation_id": operation},
        )
        await db.commit()
    try:
        result = await remote(application, "POST", "/provisioning/unlink", body=body)
    except HTTPException as error:
        # The destination's 409 contract means no unlink was performed. Unlike a
        # timeout, this can safely release the intent so a fresh revision is selectable.
        if error.status_code == 409:
            target, app, grant, policy = await rows(db, application, target_id, lock=True)
            if policy.unlink_operation_id == operation:
                policy.unlink_operation_id = None
                policy.unlink_payload = None
                policy.version += 1
                record(db, user, target, 'application_unlink_rejected', {'application': application, 'operation_id': operation})
                await db.commit()
        raise
    target, app, grant, policy = await rows(db, application, target_id, lock=True)
    if (
        policy.unlink_operation_id != operation
        or result.get("operation_id") != operation
        or str(result.get("external_user_id")) != body["external_user_id"]
    ):
        raise HTTPException(
            409,
            "Chưa xác nhận hoàn tất hủy liên kết. Hãy tải lại và thử cùng thao tác.",
        )
    await db.execute(
        delete(ApplicationPolicyOwnership).where(
            ApplicationPolicyOwnership.user_id == target_id,
            ApplicationPolicyOwnership.application_key == application,
        )
    )
    policy.enabled = False
    policy.generation = body["generation"]
    policy.identity_subject = body["identity_subject"]
    policy.pending_enabled = None
    policy.pending_generation = None
    policy.unlink_operation_id = None
    policy.unlink_payload = None
    policy.version += 1
    if grant:
        from app.db.models import utcnow

        grant.enabled = False
        grant.updated_at = utcnow()
    record(
        db,
        user,
        target,
        "application_account_unlinked",
        {
            "application": application,
            "operation_id": operation,
            "external_user_id": body["external_user_id"],
            "access_revoked": True,
        },
    )
    return {"unlinked": True, "access_revoked": True}

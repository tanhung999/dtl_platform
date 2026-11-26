"""Versioned HRM assignments shared by the Platform and HRM editors."""
from fastapi import HTTPException
from sqlalchemy import select

from app.db.applications import (
    ApplicationPermission, ApplicationRole, ApplicationRolePermission, HrmApplicationPolicy,
)
from app.modules.access.audit import record


def snapshot(row):
    return {
        "policy_version": row.version if row else 0,
        "role_keys": list(row.role_keys) if row else [],
        "permission_keys": list(row.permission_keys) if row else [],
    }


async def policy_snapshot(db, user_id):
    return snapshot(await db.get(HrmApplicationPolicy, user_id) if user_id else None)


async def apply_policy(db, target, actor, expected_version, role_keys, permission_keys, *,
                       origin, request_id=None):
    # Both callers serialize on the target Platform user row before invoking this.
    row = await db.get(HrmApplicationPolicy, target.id, with_for_update=True, populate_existing=True)
    before = snapshot(row)
    fingerprint = {
        "actor": actor.id,
        "expected_version": expected_version,
        "roles": sorted(set(role_keys)) if role_keys is not None else None,
        "permissions": sorted(set(permission_keys)) if permission_keys is not None else None,
    }
    if row and request_id and row.last_request_id == request_id:
        if fingerprint != row.last_fingerprint:
            raise HTTPException(409, "Mã yêu cầu đã dùng cho nội dung khác.")
        return before
    if expected_version != before["policy_version"]:
        raise HTTPException(409, "Quyền HRM vừa thay đổi. Hãy tải lại trước khi lưu.")

    roles = fingerprint["roles"] if role_keys is not None else before["role_keys"]
    role_ids = dict((await db.execute(
        select(ApplicationRole.key, ApplicationRole.id).where(ApplicationRole.application_key == "hrm")
    )).all())
    valid_codes = set((await db.scalars(
        select(ApplicationPermission.code).where(ApplicationPermission.application_key == "hrm")
    )).all())
    if set(roles) - role_ids.keys():
        raise HTTPException(422, "Vai trò HRM không hợp lệ.")
    if permission_keys is not None:
        permissions = fingerprint["permissions"]
    elif role_keys is not None:
        rows = (await db.execute(
            select(ApplicationRole.key, ApplicationPermission.code)
            .join(ApplicationRolePermission, ApplicationRolePermission.role_id == ApplicationRole.id)
            .join(ApplicationPermission, ApplicationPermission.id == ApplicationRolePermission.permission_id)
            .where(ApplicationRole.application_key == "hrm",
                   ApplicationPermission.application_key == "hrm",
                   ApplicationRole.key.in_(set(roles) | set(before["role_keys"])))
        )).all()
        old_defaults = {code for role, code in rows if role in before["role_keys"]}
        new_defaults = {code for role, code in rows if role in roles}
        permissions = sorted(
            (set(before["permission_keys"]) - (old_defaults - new_defaults))
            | (new_defaults - old_defaults)
        )
    else:
        permissions = before["permission_keys"]
    if set(permissions) - valid_codes:
        raise HTTPException(422, "Mã quyền HRM không hợp lệ.")
    if roles == before["role_keys"] and permissions == before["permission_keys"]:
        return before
    if row is None:
        row = HrmApplicationPolicy(user_id=target.id)
        db.add(row)
    row.version = before["policy_version"] + 1
    row.role_keys = roles
    row.permission_keys = permissions
    row.last_request_id = request_id
    row.last_fingerprint = fingerprint if request_id else None
    after = snapshot(row)
    record(db, actor, target, "application_hrm_policy_updated", {
        "application": "hrm", "origin": origin, "request_id": request_id,
        "before": before, "after": after,
    })
    await db.flush()
    return after

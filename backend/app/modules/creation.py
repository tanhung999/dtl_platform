"""One logical create per owner, resource type and request UUID."""
import hashlib
import json
from fastapi import HTTPException
from sqlalchemy import select
from app.db.models import User
from app.db.create_requests import CreateRequest


async def create_once(db, user, kind, key, data, model, factory):
    if not key:
        return await factory()
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    key = str(key)
    fingerprint = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()
    receipt = await db.get(CreateRequest, (user.id, kind, key))
    if receipt:
        if receipt.fingerprint != fingerprint:
            raise HTTPException(409, "Mã yêu cầu đã được dùng cho nội dung tạo khác. Hãy giữ nội dung ban đầu khi thử lại.")
        resource = await db.get(model, receipt.resource_id)
        if resource is None or resource.user_id != user.id:
            raise HTTPException(410, "Mục đã tạo bằng yêu cầu này đã bị xóa. Hãy đóng và tạo mới nếu cần.")
        return resource
    resource = await factory()
    db.add(CreateRequest(user_id=user.id, kind=kind, request_id=key, fingerprint=fingerprint, resource_id=resource.id))
    await db.flush()
    return resource

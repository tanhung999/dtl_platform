from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone
from urllib.parse import urlencode, urlsplit

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_sso_ticket, verify_sso_ticket
from app.db.applications import Application, SsoTicketRedemption
from app.db.models import User
from app.modules.auth.dependencies import get_current_user
from app.modules.applications.service import get_accessible_application

router = APIRouter(prefix="/api/sso", tags=["Single Sign-On (SSO)"])

class SsoLaunchRequest(BaseModel):
    target_app: str
    return_to: str = "/"


class SsoLaunchResponse(BaseModel):
    target_app: str
    ticket: str | None
    launch_url: str
    expires_in_seconds: int


class SsoVerifyRequest(BaseModel):
    ticket: str
    expected_app: str


@router.post("/launch", response_model=SsoLaunchResponse)
async def launch_sub_app(
    payload: SsoLaunchRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    target = payload.target_app.strip().lower()
    application = await get_accessible_application(db, user.id, target)
    if application is None:
        known = await db.get(Application, target)
        if known is None:
            raise HTTPException(status_code=404, detail="Ứng dụng không tồn tại")
        if not known.is_active:
            raise HTTPException(status_code=503, detail="Hệ thống đang trong giai đoạn phát triển")
        raise HTTPException(status_code=403, detail="Bạn chưa được cấp quyền truy cập ứng dụng này")

    user_dict = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "department": user.department,
        "identity_subject": user.identity_subject,
    }

    base_url = application.launch_url.rstrip("/")
    callback_path = application.callback_path
    return_to = payload.return_to.strip() or "/"
    parsed_return = urlsplit(return_to)
    if (
        not return_to.startswith("/")
        or return_to.startswith("//")
        or parsed_return.scheme
        or parsed_return.netloc
    ):
        raise HTTPException(status_code=422, detail="Đường dẫn quay lại ứng dụng không hợp lệ")
    ticket = create_sso_ticket(user_dict, target_app=target)
    launch_url = f"{base_url}{callback_path}?{urlencode({'ticket': ticket, 'return_to': return_to})}"

    return SsoLaunchResponse(
        target_app=target,
        ticket=ticket,
        launch_url=launch_url,
        expires_in_seconds=settings.SSO_TICKET_EXPIRE_SECONDS,
    )


@router.post("/verify")
async def verify_ticket_endpoint(
    payload: SsoVerifyRequest,
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    """Endpoint cho các app con gọi xác thực SSO Ticket nếu muốn đối soát tập trung."""
    try:
        claims = verify_sso_ticket(payload.ticket, expected_app=payload.expected_app)
        jti = claims.get("jti")
        subject = claims.get("sub")
        expires_at = claims.get("exp")
        if not jti or not subject or not expires_at:
            raise ValueError("Ticket thiếu định danh chống phát lại")
        db.add(SsoTicketRedemption(
            jti=jti,
            application_key=payload.expected_app,
            subject=subject,
            expires_at=datetime.fromtimestamp(expires_at, tz=timezone.utc),
        ))
        try:
            await db.flush()
        except IntegrityError as exc:
            raise HTTPException(status_code=409, detail="SSO Ticket đã được sử dụng") from exc
        return {"valid": True, "claims": claims}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SSO Ticket không hợp lệ: {str(exc)}")

from typing import Annotated, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.config import settings
from app.core.security import create_sso_ticket, verify_sso_ticket
from app.db.models import User
from app.modules.auth.dependencies import get_current_user

router = APIRouter(prefix="/api/sso", tags=["Single Sign-On (SSO)"])

TargetAppType = Literal["bookingreports", "workflows", "itam"]

APP_TARGET_URLS = {
    "bookingreports": settings.BOOKING_REPORTS_URL,
    "workflows": settings.WORKFLOWS_URL,
    "itam": settings.ASSET_MANAGER_URL,
}


class SsoLaunchRequest(BaseModel):
    target_app: TargetAppType


class SsoLaunchResponse(BaseModel):
    target_app: str
    ticket: str
    launch_url: str
    expires_in_seconds: int


class SsoVerifyRequest(BaseModel):
    ticket: str
    expected_app: TargetAppType


@router.post("/launch", response_model=SsoLaunchResponse)
async def launch_sub_app(
    payload: SsoLaunchRequest,
    user: Annotated[User, Depends(get_current_user)],
):
    target = payload.target_app
    if target not in APP_TARGET_URLS:
        raise HTTPException(status_code=400, detail="Ứng dụng mục tiêu không hợp lệ")

    user_dict = {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "department": user.department,
    }

    ticket = create_sso_ticket(user_dict, target_app=target)
    base_url = APP_TARGET_URLS[target].rstrip("/")
    launch_url = f"{base_url}/sso-callback?ticket={ticket}"

    return SsoLaunchResponse(
        target_app=target,
        ticket=ticket,
        launch_url=launch_url,
        expires_in_seconds=settings.SSO_TICKET_EXPIRE_SECONDS,
    )


@router.post("/verify")
async def verify_ticket_endpoint(payload: SsoVerifyRequest):
    """Endpoint cho các app con gọi xác thực SSO Ticket nếu muốn đối soát tập trung."""
    try:
        claims = verify_sso_ticket(payload.ticket, expected_app=payload.expected_app)
        return {"valid": True, "claims": claims}
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"SSO Ticket không hợp lệ: {str(exc)}")

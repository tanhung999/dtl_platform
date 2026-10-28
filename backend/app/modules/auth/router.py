from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, verify_password, hash_password
from app.db.models import User, utcnow
from app.db.organization import Department, Position, WorkLocation
from app.modules.auth.dependencies import get_current_user
from app.modules.auth.schemas import (
    LoginRequest,
    TokenResponse,
    UserResponse,
    ProfileUpdate,
    ChangePasswordRequest,
)
from app.modules.auth.oidc import authenticate_password

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    if settings.OIDC_ENABLED:
        user, session_token = await authenticate_password(
            db,
            payload.username.strip(),
            payload.password,
        )
        response.set_cookie(
            settings.OIDC_SESSION_COOKIE_NAME,
            session_token,
            max_age=settings.OIDC_SESSION_HOURS * 3600,
            httponly=True,
            secure=settings.OIDC_SESSION_COOKIE_SECURE,
            samesite="lax",
            path="/",
        )
        return TokenResponse(
            access_token="",
            token_type="cookie",
            expires_in=settings.OIDC_SESSION_HOURS * 3600,
            user=UserResponse.model_validate(user),
        )
    username = payload.username.strip().lower()
    stmt = select(User).where(
        (User.username == username) | (User.email == username)
    )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Tên đăng nhập hoặc mật khẩu không chính xác.",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tài khoản của bạn đã bị dừng hoạt động.",
        )

    token_data = {
        "sub": user.username,
        "user_id": user.id,
        "email": user.email,
        "role": user.role,
    }
    access_token = create_access_token(token_data)
    expires_in = settings.ACCESS_TOKEN_MINUTES * 60

    return TokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(user: Annotated[User, Depends(get_current_user)]):
    return UserResponse.model_validate(user)


@router.get("/profile-options")
async def profile_options(
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    departments = (await db.scalars(select(Department).where(Department.is_active.is_(True)).order_by(Department.name))).all()
    positions = (await db.scalars(select(Position).where(Position.is_active.is_(True)).order_by(Position.name))).all()
    locations = (await db.scalars(select(WorkLocation).where(WorkLocation.is_active.is_(True)).order_by(WorkLocation.name))).all()
    return {
        "password_min_length": 12 if settings.OIDC_ENABLED else 6,
        "departments": [{"id": row.id, "name": row.name} for row in departments],
        "positions": [{"id": row.id, "name": row.name, "department_id": row.department_id} for row in positions],
        "work_locations": [{"id": row.id, "name": row.name} for row in locations],
    }


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    payload: ProfileUpdate,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    data = payload.model_dump(exclude_unset=True)
    if "position_id" in data and (data["position_id"] or None) != (user.position_id or None):
        raise HTTPException(status_code=403, detail="Chức danh chỉ có thể được thay đổi bởi quản trị viên.")
    if "job_title" in data and (data["job_title"] or "") != (user.job_title or ""):
        raise HTTPException(status_code=403, detail="Chức danh chỉ có thể được thay đổi bởi quản trị viên.")
    if "work_location_id" in data:
        location = await db.get(WorkLocation, data["work_location_id"]) if data["work_location_id"] else None
        if data["work_location_id"] and (not location or not location.is_active):
            raise HTTPException(status_code=422, detail="Địa điểm làm việc không hợp lệ.")
        data["office_location"] = location.name if location else ""
    data = {key: value.strip() if isinstance(value, str) else value for key, value in data.items() if value is not None}
    data = {key: value for key, value in data.items() if (getattr(user, key) or '') != (value or '')}
    if not data:
        return UserResponse.model_validate(user)
    for key, value in data.items():
        if value is not None:
            setattr(user, key, value.strip() if isinstance(value, str) else value)
    user.updated_at = utcnow()
    await db.flush()
    return UserResponse.model_validate(user)


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
):
    if settings.OIDC_ENABLED:
        if payload.current_password == payload.new_password:
            raise HTTPException(400, 'Mật khẩu mới không được trùng mật khẩu cũ.')
        if len(payload.new_password) < 12:
            raise HTTPException(422, 'Mật khẩu mới phải có tối thiểu 12 ký tự.')
        if not user.identity_subject:
            raise HTTPException(409, 'Tài khoản chưa được liên kết với Keycloak.')
        try:
            verified, _ = await authenticate_password(db, user.username, payload.current_password)
        except HTTPException as exc:
            if exc.status_code == 401:
                raise HTTPException(400, 'Mật khẩu hiện tại không chính xác.') from exc
            raise
        if verified.id != user.id:
            raise HTTPException(403, 'Danh tính tài khoản không khớp.')
        from app.modules.users.keycloak import keycloak_user_admin
        from app.modules.auth.oidc import end_user_sessions
        from app.modules.access.audit import record
        await keycloak_user_admin.reset_password(user.identity_subject, payload.new_password)
        await end_user_sessions(db, user)
        record(db, user, user, 'user_password_reset', {'self_service': True})
        return {'success': True, 'message': 'Đã đổi mật khẩu. Vui lòng đăng nhập lại.', 'reauthenticate': True}
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Mật khẩu hiện tại không chính xác.")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=422, detail="Mật khẩu mới phải có tối thiểu 6 ký tự.")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="Mật khẩu mới không được trùng mật khẩu cũ.")

    user.password_hash = hash_password(payload.new_password)
    user.updated_at = utcnow()
    await db.flush()
    return {"success": True, "message": "Đã đổi mật khẩu thành công."}


@router.post("/logout", status_code=204)
async def logout():
    return None

"""Backend-only Keycloak authentication with an opaque Platform session."""

import base64
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlsplit

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_oidc_access_token, decode_oidc_id_token
from app.db.applications import Application, OidcAuthorizationState, OidcSession
from app.db.models import User

router = APIRouter(prefix="/api/auth/oidc", tags=["OIDC authentication"])
STATE_COOKIE = "dtl_oidc_state"


async def revoke_platform_sessions(db: AsyncSession, user_id: str) -> None:
    await db.execute(update(OidcSession).where(
        OidcSession.user_id == user_id, OidcSession.revoked_at.is_(None),
    ).values(revoked_at=datetime.now(timezone.utc)))


async def end_user_sessions(db: AsyncSession, user: User) -> None:
    await revoke_platform_sessions(db, user.id)
    from app.modules.users.keycloak import keycloak_user_admin
    try:
        await keycloak_user_admin.logout_user(user.identity_subject)
    except HTTPException:
        # Local revocation must still commit if Keycloak logout is unavailable.
        import logging
        logging.getLogger(__name__).warning('Keycloak logout failed after local session revocation')


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _cipher() -> AESGCM:
    material = settings.OIDC_SESSION_ENCRYPTION_SECRET or settings.SECRET_KEY
    return AESGCM(hashlib.sha256(material.encode("utf-8")).digest())


def _encrypt(value: str) -> str:
    nonce = secrets.token_bytes(12)
    payload = nonce + _cipher().encrypt(nonce, value.encode("utf-8"), None)
    return base64.urlsafe_b64encode(payload).decode("ascii")


def _safe_return_to(value: str | None) -> str:
    value = (value or "/").strip()
    parsed = urlsplit(value)
    if not value.startswith("/") or value.startswith("//") or parsed.scheme or parsed.netloc:
        return "/"
    return value


def _token_endpoint() -> str:
    return settings.OIDC_TOKEN_URL


async def authenticate_password(
    db: AsyncSession,
    username: str,
    password: str,
) -> tuple[User, str]:
    """Authenticate against Keycloak without exposing Keycloak UI to the browser."""
    if not settings.OIDC_ENABLED or not settings.OIDC_CLIENT_SECRET:
        raise HTTPException(503, "Đăng nhập tập trung chưa được cấu hình.")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            token_response = await client.post(_token_endpoint(), data={
                "grant_type": "password",
                "client_id": settings.OIDC_CLIENT_ID,
                "client_secret": settings.OIDC_CLIENT_SECRET,
                "scope": "openid profile email",
                "username": username,
                "password": password,
            })
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Không thể kết nối dịch vụ xác thực.") from exc
    if token_response.status_code in {400, 401}:
        raise HTTPException(401, "Tên đăng nhập hoặc mật khẩu không chính xác.")
    if token_response.status_code != 200:
        raise HTTPException(503, "Dịch vụ xác thực tạm thời không khả dụng.")
    tokens = token_response.json()
    try:
        claims = decode_oidc_access_token(tokens["access_token"])
        subject = str(claims["sub"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(401, "Phản hồi xác thực không hợp lệ.") from exc
    user = await db.scalar(select(User).where(User.identity_subject == subject))
    if user is None and settings.OIDC_AUTO_LINK_EXISTING_USERS:
        preferred_username = str(claims.get("preferred_username") or username).strip().lower()
        email = str(claims.get("email") or "").strip().lower()
        identity_match = User.username == preferred_username
        if email:
            identity_match = or_(identity_match, User.email == email)
        user = await db.scalar(select(User).where(User.identity_subject.is_(None), identity_match))
        if user:
            user.identity_subject = subject
    if not user or not user.is_active:
        raise HTTPException(403, "Tài khoản chưa được liên kết hoặc đã bị khóa.")
    now = datetime.now(timezone.utc)
    session_token = secrets.token_urlsafe(48)
    db.add(OidcSession(
        token_hash=_hash(session_token),
        user_id=user.id,
        keycloak_session_id=claims.get("sid"),
        refresh_token_encrypted=_encrypt(tokens["refresh_token"]) if tokens.get("refresh_token") else None,
        id_token_encrypted=_encrypt(tokens["id_token"]) if tokens.get("id_token") else None,
        expires_at=now + timedelta(hours=settings.OIDC_SESSION_HOURS),
    ))
    await db.flush()
    return user, session_token


@router.get("/config")
async def oidc_config():
    return {"enabled": settings.OIDC_ENABLED}


@router.get("/login")
async def oidc_login(
    return_to: str | None = Query(default="/", max_length=1000),
):
    target = _safe_return_to(return_to)
    return RedirectResponse(
        settings.OIDC_FRONTEND_URL.rstrip("/") + "/login?" + urlencode({"return_to": target}),
        status_code=303,
    )


def _decrypt(value: str) -> str:
    payload = base64.urlsafe_b64decode(value.encode("ascii"))
    return _cipher().decrypt(payload[:12], payload[12:], None).decode("utf-8")


@router.get("/callback")
async def oidc_callback(
    response: Response,
    code: str = Query(min_length=1, max_length=4096),
    state: str = Query(min_length=20, max_length=500),
    state_cookie: str | None = Cookie(default=None, alias=STATE_COOKIE),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    if not state_cookie or not secrets.compare_digest(state, state_cookie):
        raise HTTPException(400, "Phiên đăng nhập OIDC không hợp lệ.")
    row = await db.scalar(select(OidcAuthorizationState).where(
        OidcAuthorizationState.state_hash == _hash(state)).with_for_update())
    now = datetime.now(timezone.utc)
    if not row or row.expires_at <= now:
        raise HTTPException(400, "Phiên đăng nhập OIDC đã hết hạn.")
    await db.delete(row)
    async with httpx.AsyncClient(timeout=10) as client:
        token_response = await client.post(_token_endpoint(), data={
            "grant_type": "authorization_code",
            "client_id": settings.OIDC_CLIENT_ID,
            "client_secret": settings.OIDC_CLIENT_SECRET,
            "redirect_uri": settings.OIDC_REDIRECT_URI,
            "code": code,
            "code_verifier": _decrypt(row.verifier_encrypted),
        })
    if token_response.status_code != 200:
        raise HTTPException(401, "Keycloak từ chối mã đăng nhập.")
    tokens = token_response.json()
    claims = decode_oidc_access_token(tokens["access_token"])
    id_claims = decode_oidc_id_token(tokens["id_token"], row.nonce)
    if id_claims.get("sub") != claims.get("sub"):
        raise HTTPException(401, "Danh tính OIDC không nhất quán.")
    subject = claims["sub"]
    user = await db.scalar(select(User).where(User.identity_subject == subject))
    if user is None and settings.OIDC_AUTO_LINK_EXISTING_USERS:
        username, email = claims.get("preferred_username"), claims.get("email")
        user = await db.scalar(select(User).where(
            User.identity_subject.is_(None),
            or_(User.username == username, User.email == email),
        ))
        if user:
            user.identity_subject = subject
    if not user or not user.is_active:
        raise HTTPException(403, "Tài khoản chưa được liên kết hoặc đã bị khóa.")
    session_token = secrets.token_urlsafe(48)
    expires_at = now + timedelta(hours=settings.OIDC_SESSION_HOURS)
    db.add(OidcSession(
        token_hash=_hash(session_token), user_id=user.id,
        keycloak_session_id=claims.get("sid"),
        refresh_token_encrypted=_encrypt(tokens["refresh_token"]) if tokens.get("refresh_token") else None,
        id_token_encrypted=_encrypt(tokens["id_token"]) if tokens.get("id_token") else None,
        expires_at=expires_at,
    ))
    redirect = RedirectResponse(settings.OIDC_FRONTEND_URL.rstrip("/") + row.return_to, status_code=303)
    redirect.set_cookie(settings.OIDC_SESSION_COOKIE_NAME, session_token,
        max_age=settings.OIDC_SESSION_HOURS * 3600, httponly=True,
        secure=settings.OIDC_SESSION_COOKIE_SECURE, samesite="lax", path="/")
    redirect.delete_cookie(STATE_COOKIE, path="/api/auth/oidc")
    return redirect


@router.post("/logout")
async def oidc_logout(
    response: Response,
    session_token: str | None = Cookie(default=None, alias=settings.OIDC_SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db, scope="function"),
):
    refresh_token = None
    if session_token:
        session = await db.scalar(select(OidcSession).where(
            OidcSession.token_hash == _hash(session_token),
            OidcSession.revoked_at.is_(None),
        ).with_for_update())
        if session:
            session.revoked_at = datetime.now(timezone.utc)
            if session.refresh_token_encrypted:
                refresh_token = _decrypt(session.refresh_token_encrypted)
    if refresh_token:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(settings.OIDC_END_SESSION_URL, data={
                    "client_id": settings.OIDC_CLIENT_ID,
                    "client_secret": settings.OIDC_CLIENT_SECRET,
                    "refresh_token": refresh_token,
                })
        except httpx.HTTPError:
            pass
    response.delete_cookie(
        settings.OIDC_SESSION_COOKIE_NAME,
        path="/",
        secure=settings.OIDC_SESSION_COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    applications = (await db.scalars(select(Application).where(Application.is_active.is_(True)))).all()
    logout_targets = [
        application.launch_url.rstrip("/") + "/api/auth/local-logout"
        for application in applications
    ]
    return {"logout_url": None, "logout_targets": logout_targets}

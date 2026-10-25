from typing import Annotated
from fastapi import Depends, HTTPException, status, Request, Response
import json
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import decode_access_token, decode_oidc_access_token
from app.core.config import settings
from app.db.models import User
from app.db.applications import OidcSession
import hashlib
from datetime import datetime, timezone

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    request: Request,
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
) -> User:
    if credentials and credentials.scheme.lower() == "bearer":
        try:
            if settings.OIDC_ENABLED:
                payload = decode_oidc_access_token(credentials.credentials)
                identity_filter = User.identity_subject == payload.get("sub")
            else:
                payload = decode_access_token(credentials.credentials)
                identity_filter = User.username == payload.get("sub")
            if not payload.get("sub"):
                raise HTTPException(status_code=401, detail="Phiên đăng nhập không hợp lệ")
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Access token hết hạn hoặc không hợp lệ",
                headers={"WWW-Authenticate": "Bearer"},
            ) from e
        stmt = select(User).where(identity_filter, User.is_active.is_(True))
    else:
        opaque = request.cookies.get(settings.OIDC_SESSION_COOKIE_NAME)
        if not opaque:
            raise HTTPException(status_code=401, detail="Vui lòng đăng nhập để tiếp tục")
        token_hash = hashlib.sha256(opaque.encode("utf-8")).hexdigest()
        stmt = (
            select(User)
            .join(OidcSession, OidcSession.user_id == User.id)
            .where(
                OidcSession.token_hash == token_hash,
                OidcSession.revoked_at.is_(None),
                OidcSession.expires_at > datetime.now(timezone.utc),
                User.is_active.is_(True),
            )
        )
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="Tài khoản không tồn tại hoặc đã bị khóa")
    from app.core.workspace_versions import read_scopes, read_versions
    scopes = read_scopes(request.url.path) if request.method == 'GET' else ()
    if scopes:
        response.headers['X-Workspace-Versions'] = json.dumps(await read_versions(db, user.id, scopes), separators=(',', ':'))
        response.headers['Cache-Control'] = 'no-store'
    return user

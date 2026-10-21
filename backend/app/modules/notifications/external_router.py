"""Đổi SSO/gia hạn phiên cho backend của ba ứng dụng; không nhận ID người dùng tùy ý."""
from datetime import datetime, timezone
from typing import Annotated, Literal
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_sso_ticket
from app.db.models import User
from .auth import SCOPES, client_secret, decode_notification_token, issue_notification_token
from .integration_auth import signed_body

router = APIRouter(prefix='/api/integrations', tags=['Notification API access'])


class TokenExchange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    sso_ticket: str | None = Field(default=None, min_length=1, max_length=8192)
    access_token: str | None = Field(default=None, min_length=1, max_length=8192)

    @model_validator(mode='after')
    def one_credential(self):
        if bool(self.sso_ticket) == bool(self.access_token):
            raise ValueError('Cung cấp một SSO ticket hoặc token cần gia hạn.')
        return self


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal['Bearer']
    expires_in: int
    session_expires_at: datetime
    scope: str


@router.post('/{source}/notification-token', response_model=TokenResponse)
async def exchange(source: Literal['bookingreports', 'workflows', 'itam'], request: Request, response: Response,
                   db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    response.headers['Cache-Control'] = 'no-store'
    if len(settings.NOTIFICATIONS_API_SIGNING_SECRET) < 32:
        raise HTTPException(503, 'API thông báo liên ứng dụng chưa được cấu hình.')
    body = await signed_body(request, client_secret(source), source, purpose='notification-token')
    try:
        payload = TokenExchange.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, 'Yêu cầu cấp token không hợp lệ.')
    try:
        if payload.sso_ticket:
            claims = verify_sso_ticket(payload.sso_ticket, expected_app=source)
            user_id = claims['user_id']
            session_exp = int(datetime.now(timezone.utc).timestamp()) + settings.NOTIFICATIONS_API_SESSION_SECONDS
            scopes = SCOPES
        else:
            # Only this signed backend endpoint can renew an expired access token.
            # The original session deadline, app key and account permission still apply.
            claims = decode_notification_token(payload.access_token, for_renewal=True)
            if claims['app'] != source:
                raise ValueError('Token thuộc ứng dụng khác.')
            user_id, session_exp = claims['sub'], claims['session_exp']
            scopes = claims['scope']
    except (jwt.PyJWTError, ValueError, TypeError, KeyError):
        raise HTTPException(401, 'Thông tin SSO/token hết hạn hoặc không hợp lệ.')
    user = await db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if not user or (payload.sso_ticket and user.username != claims.get('sub')):
        raise HTTPException(401, 'Tài khoản không tồn tại hoặc đã bị khóa.')
    if source not in (user.allowed_apps or '').split(','):
        raise HTTPException(403, 'Người dùng không có quyền truy cập ứng dụng này.')
    return issue_notification_token(user.id, source, session_exp, scopes)

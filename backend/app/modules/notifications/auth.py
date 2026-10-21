"""Token ủy quyền chỉ dùng cho hộp thông báo của người dùng SSO."""
import hashlib
import secrets
from datetime import datetime, timezone
from typing import Annotated
import jwt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.db.models import User
from app.modules.auth.dependencies import bearer_scheme, get_current_user

APPS = ('bookingreports', 'workflows', 'itam')
AUDIENCE = 'dtl-notifications'
SCOPES = ('notifications:read', 'notifications:write')


def client_secret(source):
    return getattr(settings, f'NOTIFICATIONS_{source.upper()}_API_SECRET')


def key_id(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


def decode_notification_token(token, *, for_renewal=False):
    if len(settings.NOTIFICATIONS_API_SIGNING_SECRET) < 32:
        raise ValueError('Chưa cấu hình chữ ký API thông báo.')
    claims = jwt.decode(token, settings.NOTIFICATIONS_API_SIGNING_SECRET, algorithms=['HS256'],
                        audience=AUDIENCE, issuer='dtl-platform',
                        options={'verify_exp': not for_renewal,
                                 'require': ['sub', 'app', 'iat', 'exp', 'session_exp', 'jti', 'scope', 'client_key_id']})
    if claims.get('token_use') != 'notification_access' or claims['app'] not in APPS:
        raise ValueError('Sai loại token.')
    if not isinstance(claims['sub'], str) or not claims['sub'] or not isinstance(claims['scope'], list):
        raise ValueError('Sai thông tin token.')
    if any(scope not in SCOPES for scope in claims['scope']):
        raise ValueError('Sai phạm vi token.')
    if not isinstance(claims['session_exp'], int) or claims['session_exp'] <= datetime.now(timezone.utc).timestamp():
        raise ValueError('Phiên tích hợp đã hết hạn.')
    if not isinstance(claims['exp'], int) or claims['exp'] > claims['session_exp']:
        raise ValueError('Sai hạn token.')
    secret = client_secret(claims['app'])
    if len(secret) < 32 or claims['client_key_id'] != key_id(secret):
        raise ValueError('Ứng dụng đã ngắt kết nối hoặc đổi khóa.')
    return claims


def issue_notification_token(user_id, source, session_exp, scopes=SCOPES):
    now = int(datetime.now(timezone.utc).timestamp())
    expires = min(now + settings.NOTIFICATIONS_API_TOKEN_SECONDS, session_exp)
    claims = {'iss': 'dtl-platform', 'aud': AUDIENCE, 'sub': user_id, 'app': source,
              'token_use': 'notification_access', 'scope': list(scopes), 'jti': secrets.token_urlsafe(24),
              'iat': now, 'exp': expires, 'session_exp': session_exp, 'client_key_id': key_id(client_secret(source))}
    return {'access_token': jwt.encode(claims, settings.NOTIFICATIONS_API_SIGNING_SECRET, algorithm='HS256'),
            'token_type': 'Bearer', 'expires_in': expires - now, 'session_expires_at': datetime.fromtimestamp(session_exp, timezone.utc),
            'scope': ' '.join(scopes)}


async def notification_user(request: Request, response: Response,
                            credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
                            db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    response.headers['Cache-Control'] = 'no-store'
    if not credentials or credentials.scheme.lower() != 'bearer':
        return await get_current_user(request, response, credentials, db)
    try:
        claims = decode_notification_token(credentials.credentials)
    except (jwt.PyJWTError, ValueError, TypeError):
        # Preserve the existing Platform login contract; scoped tokens fail its audience/key validation.
        return await get_current_user(request, response, credentials, db)
    path = request.url.path.removeprefix('/api/notifications').strip('/')
    parts = path.split('/')
    read = request.method == 'GET' and (path in ('', 'summary') or (len(parts) == 2 and parts[1] == 'destination'))
    write = ((request.method == 'PATCH' and len(parts) == 1 and path not in ('', 'preferences'))
             or (request.method == 'POST' and path == 'read-all'))
    scope = 'notifications:read' if read else 'notifications:write' if write else None
    if scope is None or scope not in claims['scope']:
        raise HTTPException(403, 'Token không có quyền thực hiện thao tác này.')
    user = await db.scalar(select(User).where(User.id == claims['sub'], User.is_active.is_(True)))
    if not user:
        raise HTTPException(401, 'Tài khoản không tồn tại hoặc đã bị khóa.')
    if claims['app'] not in (user.allowed_apps or '').split(','):
        raise HTTPException(403, 'Bạn không còn quyền truy cập ứng dụng này.')
    return user

"""Server-to-server inbox ingestion for the three enterprise apps, disabled until configured."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import unquote, urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.db.models import User, utcnow
from app.db.notifications import Notification, NotificationPreference
from .service import changed, fingerprint
from .integration_auth import signed_body

router = APIRouter(prefix='/api/integrations', tags=['Notification integrations'])
Source = Literal['bookingreports', 'workflows', 'itam']

class IncomingNotification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    external_id: str = Field(min_length=1, max_length=160)
    recipient_user_id: str = Field(min_length=1, max_length=36)
    title: str = Field(min_length=1, max_length=255)
    body: str = Field(default='', max_length=1200)
    kind: Literal['info', 'approval', 'assignment', 'reminder', 'cancelled'] = 'info'
    resource_type: str = Field(default='record', min_length=1, max_length=24, pattern=r'^[a-z_]+$')
    resource_id: str = Field(default='', max_length=128)
    action_path: str = Field(default='', max_length=500)
    occurred_at: datetime | None = None

    @field_validator('title', 'external_id', mode='before')
    @classmethod
    def trimmed(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('occurred_at')
    @classmethod
    def aware(cls, value):
        if value and not value.tzinfo: raise ValueError('Thời gian phải kèm múi giờ.')
        return value.astimezone(timezone.utc) if value else None

    @field_validator('action_path')
    @classmethod
    def safe_path(cls, value):
        decoded = value
        while unquote(decoded) != decoded:
            decoded = unquote(decoded)
        parsed = urlsplit(decoded)
        if value and (not decoded.startswith('/') or decoded.startswith('//') or parsed.netloc or parsed.scheme or '\\' in decoded or any(ord(c) < 32 for c in decoded)):
            raise ValueError('Đường dẫn phải nằm trong ứng dụng nguồn.')
        return value

@router.post('/{source}/notifications')
async def receive(source: Source, request: Request, db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    body = await signed_body(request, getattr(settings, f'NOTIFICATIONS_{source.upper()}_SECRET'), source)
    try:
        payload = IncomingNotification.model_validate_json(bytes(body))
    except ValidationError:
        raise HTTPException(422, 'Nội dung thông báo không hợp lệ.')
    user = await db.scalar(select(User).where(User.id == payload.recipient_user_id, User.is_active.is_(True)).with_for_update())
    if not user: raise HTTPException(404, 'Không tìm thấy người nhận.')
    if source not in (user.allowed_apps or '').split(','):
        raise HTTPException(403, 'Người nhận không có quyền truy cập ứng dụng nguồn.')
    digest = fingerprint(payload.model_dump(mode='json'))
    existing = await db.scalar(select(Notification).where(Notification.user_id == user.id, Notification.source == source, Notification.event_key == payload.external_id))
    if existing:
        if existing.fingerprint != digest: raise HTTPException(409, 'Mã sự kiện đã được dùng cho nội dung khác.')
        return {'id': existing.id, 'duplicate': True}
    preference = await db.get(NotificationPreference, user.id)
    muted = preference is not None and not getattr(preference, source)
    now = utcnow()
    row = Notification(user_id=user.id, source=source, event_key=payload.external_id, fingerprint=digest, kind='external.' + payload.kind,
        title=payload.title, body=payload.body, resource_type=f'{source}.{payload.resource_type}', resource_id=payload.resource_id,
        action_path=payload.action_path, occurred_at=payload.occurred_at or now, created_at=now, read_at=now if muted else None, dismissed_at=now if muted else None)
    db.add(row)
    await db.flush()
    changed(db, user.id)
    return {'id': row.id, 'duplicate': False, 'muted': muted}

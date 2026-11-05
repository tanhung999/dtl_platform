"""Server-to-server inbox ingestion for the three enterprise apps, disabled until configured."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from urllib.parse import unquote, urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
import hashlib
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.db.models import User, utcnow
from app.db.notifications import Notification, NotificationPreference, ExternalNotificationState as State, NotificationReadOutbox as Outbox
from app.db.applications import ApplicationPolicyOwnership
from .service import changed, fingerprint
from .integration_auth import signed_body
from .external_sync import apply_source_read, read_snapshot
from .external_access import external_visibility

router = APIRouter(prefix='/api/integrations', tags=['Notification integrations'])
Source = Literal['bookingreports', 'workflows', 'itam']

class IncomingNotification(BaseModel):
    model_config = ConfigDict(extra='forbid')
    external_id: str = Field(min_length=1, max_length=160)
    recipient_user_id: str | None = Field(default=None, min_length=1, max_length=36)
    recipient_subject: str = Field(min_length=1, max_length=255)
    external_user_id: str = Field(min_length=1, max_length=100)
    link_operation_id: str = Field(min_length=1, max_length=36)
    read: bool = False
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
    user = await resolve_recipient(db, source, payload)
    digest = fingerprint(payload.model_dump(mode='json', exclude={'read', 'recipient_user_id'}))
    event_key = 'external:' + hashlib.sha256(f'{payload.link_operation_id}:{payload.external_user_id}:{payload.external_id}'.encode()).hexdigest()
    existing = await db.scalar(select(Notification).where(Notification.user_id == user.id, Notification.source == source, Notification.event_key == event_key))
    if existing:
        if existing.fingerprint != digest:
            raise HTTPException(409, 'Mã sự kiện đã được dùng cho nội dung khác.')
        state = await db.get(State, existing.id)
        return {'duplicate': True, **read_snapshot(existing, state)}
    preference = await db.get(NotificationPreference, user.id)
    muted = preference is not None and not getattr(preference, source)
    now = utcnow()
    row = Notification(user_id=user.id, source=source, event_key=event_key, fingerprint=digest, kind='external.' + payload.kind,
        title=payload.title, body=payload.body, resource_type=f'{source}.{payload.resource_type}', resource_id=payload.resource_id,
        action_path=payload.action_path, occurred_at=payload.occurred_at or now, created_at=now,
        read_at=now if payload.read else None, dismissed_at=now if muted else None)
    db.add(row)
    await db.flush()
    state = State(notification_id=row.id, external_id=payload.external_id, identity_subject=payload.recipient_subject,
                  external_user_id=payload.external_user_id, link_operation_id=payload.link_operation_id, read_version=0)
    db.add(state)
    await db.flush()
    changed(db, user.id)
    return {'duplicate': False, 'muted': muted, **read_snapshot(row, state)}


async def resolve_recipient(db, source, payload):
    from .external_access import require_application_access
    user = await db.scalar(select(User).where(User.identity_subject == payload.recipient_subject,
        User.is_active.is_(True)).with_for_update())
    if user is None or (getattr(payload, 'recipient_user_id', None) and user.id != payload.recipient_user_id):
        raise HTTPException(404, 'Không tìm thấy người nhận đã liên kết.')
    await require_application_access(db, user.id, source)
    ownership = await db.get(ApplicationPolicyOwnership, (user.id, source))
    if not ownership or ownership.external_user_id != payload.external_user_id or ownership.operation_id != payload.link_operation_id:
        raise HTTPException(409, 'Liên kết tài khoản đã thay đổi. Không thể nhận dữ liệu từ tài khoản cũ.')
    return user


class SourceRead(BaseModel):
    model_config = ConfigDict(extra='forbid')
    recipient_subject: str = Field(min_length=1, max_length=255)
    external_user_id: str = Field(min_length=1, max_length=100)
    link_operation_id: str = Field(min_length=1, max_length=36)
    external_id: str = Field(min_length=1, max_length=160)
    read: bool
    expected_version: int = Field(ge=0)


async def signed_payload(source, request, model, purpose):
    body = await signed_body(request, getattr(settings, f'NOTIFICATIONS_{source.upper()}_SECRET'), source, purpose=purpose)
    try:
        return model.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, 'Nội dung đồng bộ thông báo không hợp lệ.')


@router.post('/{source}/notification-read-state')
async def source_read(source: Source, request: Request, db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    payload = await signed_payload(source, request, SourceRead, 'notification-read-state')
    user = await resolve_recipient(db, source, payload)
    pair = (await db.execute(select(Notification, State).join(State, State.notification_id == Notification.id).where(
        Notification.user_id == user.id, Notification.source == source, State.external_id == payload.external_id,
        State.link_operation_id == payload.link_operation_id, State.external_user_id == payload.external_user_id).with_for_update(of=Notification))).one_or_none()
    if not pair:
        raise HTTPException(404, 'Không tìm thấy thông báo đã đồng bộ.')
    await db.refresh(pair[1], with_for_update=True)
    return await apply_source_read(db, *pair, read=payload.read, expected_version=payload.expected_version)


class ReadChanges(BaseModel):
    model_config = ConfigDict(extra='forbid')
    limit: int = Field(default=100, ge=1, le=100)


@router.post('/{source}/notification-read-changes')
async def read_changes(source: Source, request: Request, db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    payload = await signed_payload(source, request, ReadChanges, 'notification-read-changes')
    rows = (await db.execute(select(Notification, State).join(State, State.notification_id == Notification.id)
        .join(Outbox, Outbox.notification_id == Notification.id).where(Notification.source == source, external_visibility(),
            Outbox.acknowledged_revision < Outbox.revision).order_by(Outbox.updated_at, Notification.id).limit(payload.limit))).all()
    return {'items': [read_snapshot(notice, state) for notice, state in rows]}


class ReadAcknowledgement(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str = Field(min_length=1, max_length=36)
    read_version: int = Field(ge=0)


class ReadAcknowledgements(BaseModel):
    model_config = ConfigDict(extra='forbid')
    items: list[ReadAcknowledgement] = Field(min_length=1, max_length=100)


@router.post('/{source}/notification-read-ack')
async def acknowledge_reads(source: Source, request: Request, db: Annotated[AsyncSession, Depends(get_db, scope='function')]):
    payload = await signed_payload(source, request, ReadAcknowledgements, 'notification-read-ack')
    acknowledged = 0
    for item in sorted(payload.items, key=lambda item: item.id):
        row = await db.scalar(select(Outbox).join(Notification, Notification.id == Outbox.notification_id).where(
            Notification.source == source, Outbox.notification_id == item.id, external_visibility()).with_for_update(of=Outbox))
        if row is not None and row.acknowledged_revision < item.read_version <= row.revision:
            row.acknowledged_revision = item.read_version
            acknowledged += 1
    return {'acknowledged': acknowledged}

"""Dynamic enterprise application registry and user entitlements."""

from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from app.core.database import Base
from app.db.types import UTCDateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Application(Base):
    __tablename__ = "applications"

    key = Column(String(80), primary_key=True)
    display_name = Column(String(160), nullable=False)
    description = Column(Text, nullable=False, default="")
    category = Column(String(100), nullable=False, default="Ứng dụng doanh nghiệp")
    icon_key = Column(String(80), nullable=False, default="platform")
    icon_url = Column(String(500), nullable=True)
    launch_url = Column(String(1000), nullable=False)
    callback_path = Column(String(255), nullable=False, default="/sso-callback")
    oidc_client_id = Column(String(160), nullable=True)
    oidc_audience = Column(String(160), nullable=True)
    permission_prefix = Column(String(100), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    legacy_login_enabled = Column(Boolean, nullable=False, default=False)
    sort_order = Column(Integer, nullable=False, default=100)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)


class UserApplicationAccess(Base):
    __tablename__ = "user_application_access"
    __table_args__ = (
        UniqueConstraint("user_id", "application_key", name="uq_user_application_access"),
    )

    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    application_key = Column(
        String(80), ForeignKey("applications.key", ondelete="CASCADE"), primary_key=True
    )
    enabled = Column(Boolean, nullable=False, default=True)
    role_id = Column(String(180), ForeignKey("application_roles.id", ondelete="SET NULL"), nullable=True)
    permission_overrides = Column(JSON, nullable=False, default=dict)
    project_names = Column(JSON, nullable=False, default=list)
    granted_by_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    granted_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    updated_at = Column(UTCDateTime(), nullable=False, default=utcnow, onupdate=utcnow)


class ApplicationRole(Base):
    __tablename__ = "application_roles"
    __table_args__ = (UniqueConstraint("application_key", "key", name="uq_application_role_key"),)

    id = Column(String(180), primary_key=True)
    application_key = Column(String(80), ForeignKey("applications.key", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(100), nullable=False)
    display_name = Column(String(180), nullable=False)
    description = Column(Text, nullable=False, default="")
    sort_order = Column(Integer, nullable=False, default=100)


class ApplicationPermission(Base):
    __tablename__ = "application_permissions"
    __table_args__ = (UniqueConstraint("application_key", "code", name="uq_application_permission_code"),)

    id = Column(String(220), primary_key=True)
    application_key = Column(String(80), ForeignKey("applications.key", ondelete="CASCADE"), nullable=False, index=True)
    code = Column(String(140), nullable=False)
    display_name = Column(String(220), nullable=False)
    group_name = Column(String(120), nullable=False, default="Chức năng")
    sort_order = Column(Integer, nullable=False, default=100)


class ApplicationRolePermission(Base):
    __tablename__ = "application_role_permissions"

    role_id = Column(String(180), ForeignKey("application_roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id = Column(String(220), ForeignKey("application_permissions.id", ondelete="CASCADE"), primary_key=True)


class SsoTicketRedemption(Base):
    """Temporary replay protection while legacy launch tickets are being retired."""

    __tablename__ = "sso_ticket_redemptions"

    jti = Column(String(200), primary_key=True)
    application_key = Column(String(80), ForeignKey("applications.key", ondelete="CASCADE"), nullable=False)
    subject = Column(String(160), nullable=False)
    expires_at = Column(UTCDateTime(), nullable=False)
    redeemed_at = Column(UTCDateTime(), nullable=False, default=utcnow)


class OidcAuthorizationState(Base):
    __tablename__ = "oidc_authorization_states"

    state_hash = Column(String(64), primary_key=True)
    verifier_encrypted = Column(Text, nullable=False)
    nonce = Column(String(200), nullable=False)
    return_to = Column(String(1000), nullable=False, default="/")
    expires_at = Column(UTCDateTime(), nullable=False)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)


class OidcSession(Base):
    __tablename__ = "oidc_sessions"

    token_hash = Column(String(64), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    keycloak_session_id = Column(String(255), nullable=True, index=True)
    refresh_token_encrypted = Column(Text, nullable=True)
    id_token_encrypted = Column(Text, nullable=True)
    expires_at = Column(UTCDateTime(), nullable=False, index=True)
    revoked_at = Column(UTCDateTime(), nullable=True)
    created_at = Column(UTCDateTime(), nullable=False, default=utcnow)
    last_seen_at = Column(UTCDateTime(), nullable=False, default=utcnow)

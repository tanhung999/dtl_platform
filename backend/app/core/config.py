from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "DTL Platform"
    APP_ENV: str = "development"
    DEBUG: bool = True
    ALLOW_INSECURE_LOCAL_CONFIG: bool = False
    
    # Security & Tokens
    SECRET_KEY: str = "dtl_platform_super_secret_key_change_in_production_2026"
    SSO_SECRET_KEY: str = "dtl_sso_shared_secret_for_ticket_exchange_32_chars"
    ACCESS_TOKEN_MINUTES: int = 480  # 8 hours
    SSO_TICKET_EXPIRE_SECONDS: int = 60  # 60s single-use ticket
    OIDC_ENABLED: bool = False
    OIDC_ISSUER: str = "http://localhost:5173/auth/realms/dtl"
    OIDC_AUTHORIZATION_URL: str = "http://localhost:5173/auth/realms/dtl/protocol/openid-connect/auth"
    OIDC_TOKEN_URL: str = "http://localhost:8081/auth/realms/dtl/protocol/openid-connect/token"
    OIDC_JWKS_URL: str = "http://localhost:8081/auth/realms/dtl/protocol/openid-connect/certs"
    OIDC_END_SESSION_URL: str = "http://localhost:5173/auth/realms/dtl/protocol/openid-connect/logout"
    OIDC_AUDIENCE: str = "dtl-platform"
    OIDC_ALGORITHMS: List[str] = ["RS256"]
    OIDC_CLIENT_ID: str = "dtl-platform"
    OIDC_CLIENT_SECRET: str = ""
    OIDC_REDIRECT_URI: str = "http://localhost:5173/api/auth/oidc/callback"
    OIDC_FRONTEND_URL: str = "http://localhost:5173"
    OIDC_POST_LOGOUT_REDIRECT_URI: str = "http://localhost:5173/login"
    OIDC_SESSION_ENCRYPTION_SECRET: str = ""
    OIDC_SESSION_COOKIE_NAME: str = "dtl_platform_session"
    OIDC_SESSION_COOKIE_SECURE: bool = False
    OIDC_SESSION_HOURS: int = Field(default=8, ge=1, le=24)
    OIDC_STATE_SECONDS: int = Field(default=300, ge=60, le=900)
    OIDC_AUTO_LINK_EXISTING_USERS: bool = False
    INTEGRATION_BOOKINGREPORTS_SECRET: str = ""
    INTEGRATION_WORKFLOWS_SECRET: str = ""
    INTEGRATION_ITAM_SECRET: str = ""
    # Deprecated development fallback. Production requires one secret per application.
    INTEGRATION_SHARED_SECRET: str = ""
    KEYCLOAK_ADMIN_BASE_URL: str = "http://localhost:8081/auth"
    KEYCLOAK_ADMIN_REALM: str = "dtl"
    KEYCLOAK_ADMIN_CLIENT_ID: str = "platform-user-admin"
    KEYCLOAK_ADMIN_CLIENT_SECRET: str = ""
    
    # Database (defaults to local SQLite for instant developer setup, or postgres in production)
    DATABASE_URL: str = "sqlite+aiosqlite:///./platform.db"
    DB_POOL_SIZE: int = 8
    DB_MAX_OVERFLOW: int = 4
    DB_POOL_TIMEOUT: int = 5
    DB_STATEMENT_TIMEOUT_MS: int = 8000
    DB_LOCK_TIMEOUT_MS: int = 3000
    NOTIFICATIONS_WORKER_ENABLED: bool = True
    MAINTENANCE_ENABLED: bool = True
    MAINTENANCE_INTERVAL_SECONDS: int = Field(default=600, ge=60)
    MAINTENANCE_BATCH_SIZE: int = Field(default=500, ge=1, le=5000)
    SCHEDULE_HISTORY_RETENTION_DAYS: int = Field(default=365, ge=0)
    PROCESSED_JOB_RETENTION_DAYS: int = Field(default=30, ge=0)
    NOTIFICATIONS_BOOKINGREPORTS_SECRET: str = ''
    NOTIFICATIONS_WORKFLOWS_SECRET: str = ''
    NOTIFICATIONS_ITAM_SECRET: str = ''
    # Khóa API đọc tách khỏi khóa gửi thông báo và khóa SSO.
    NOTIFICATIONS_API_SIGNING_SECRET: str = ''
    NOTIFICATIONS_BOOKINGREPORTS_API_SECRET: str = ''
    NOTIFICATIONS_WORKFLOWS_API_SECRET: str = ''
    NOTIFICATIONS_ITAM_API_SECRET: str = ''
    NOTIFICATIONS_API_TOKEN_SECONDS: int = Field(default=900, ge=60, le=1800)
    NOTIFICATIONS_API_SESSION_SECONDS: int = Field(default=28800, ge=900, le=86400)
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:8444",
    ]
    
    # Sub-apps Launch URLs
    BOOKING_REPORTS_URL: str = "http://localhost:3000"
    WORKFLOWS_URL: str = "http://localhost:8082"
    ASSET_MANAGER_URL: str = "http://localhost:8444"

    def validate_production(self) -> None:
        if self.APP_ENV.lower() != "production" or self.ALLOW_INSECURE_LOCAL_CONFIG:
            return
        secrets_to_check = {
            "SECRET_KEY": self.SECRET_KEY,
            "SSO_SECRET_KEY": self.SSO_SECRET_KEY,
            "OIDC_CLIENT_SECRET": self.OIDC_CLIENT_SECRET,
            "OIDC_SESSION_ENCRYPTION_SECRET": self.OIDC_SESSION_ENCRYPTION_SECRET,
            "INTEGRATION_BOOKINGREPORTS_SECRET": self.INTEGRATION_BOOKINGREPORTS_SECRET,
            "INTEGRATION_WORKFLOWS_SECRET": self.INTEGRATION_WORKFLOWS_SECRET,
            "INTEGRATION_ITAM_SECRET": self.INTEGRATION_ITAM_SECRET,
            "KEYCLOAK_ADMIN_CLIENT_SECRET": self.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }
        invalid = [
            name
            for name, value in secrets_to_check.items()
            if len((value or "").strip()) < 32
            or any(marker in (value or "").lower() for marker in ("change-me", "local-secret", "replace-with"))
        ]
        if invalid:
            raise RuntimeError(
                "Không được chạy production với secret mẫu hoặc quá ngắn: "
                + ", ".join(invalid)
            )
        if self.OIDC_ENABLED and not self.OIDC_SESSION_COOKIE_SECURE:
            raise RuntimeError(
                "OIDC_SESSION_COOKIE_SECURE=true là bắt buộc trong production."
            )

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()

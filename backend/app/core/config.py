from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "DTL Platform"
    APP_ENV: str = "development"
    DEBUG: bool = True
    
    # Security & Tokens
    SECRET_KEY: str = "dtl_platform_super_secret_key_change_in_production_2026"
    SSO_SECRET_KEY: str = "dtl_sso_shared_secret_for_ticket_exchange_32_chars"
    ACCESS_TOKEN_MINUTES: int = 480  # 8 hours
    SSO_TICKET_EXPIRE_SECONDS: int = 60  # 60s single-use ticket
    
    # Database (defaults to local SQLite for instant developer setup, or postgres in production)
    DATABASE_URL: str = "sqlite+aiosqlite:///./platform.db"
    
    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:8444",
    ]
    
    # Sub-apps Launch URLs
    BOOKING_REPORTS_URL: str = "http://localhost:5174"
    WORKFLOWS_URL: str = "http://localhost:8080"
    ASSET_MANAGER_URL: str = "http://localhost:8444"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()

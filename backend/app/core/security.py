import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import jwt

from app.core.config import settings

PASSWORD_ITERATIONS = 310_000


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    salt_b64 = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_b64 = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt_b64}${digest_b64}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        parts = encoded.split("$")
        if len(parts) == 4 and parts[0] == "pbkdf2_sha256":
            _, iterations, salt_b64, expected_b64 = parts
            salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
            expected = base64.urlsafe_b64decode(expected_b64.encode("ascii"))
            actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, int(iterations))
            return hmac.compare_digest(actual, expected)
        # Fallback for plain comparison in demo seeds if any
        return False
    except Exception:
        return False


def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_MINUTES))
    to_encode.update({"iat": now, "exp": expire, "iss": "dtl-platform"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")


def decode_access_token(token: str) -> Dict[str, Any]:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"], issuer="dtl-platform")


def create_sso_ticket(user: Dict[str, Any], target_app: str) -> str:
    """Generate a short-lived (60s) single-use SSO Ticket for launching sub-applications."""
    now = datetime.now(timezone.utc)
    expire = now + timedelta(seconds=settings.SSO_TICKET_EXPIRE_SECONDS)
    payload = {
        "iss": "dtl-platform",
        "sub": user["username"],
        "user_id": str(user["id"]),
        "email": user["email"],
        "full_name": user["full_name"],
        "target_app": target_app,
        "jti": secrets.token_urlsafe(16),
        "iat": now,
        "exp": expire,
    }
    return jwt.encode(payload, settings.SSO_SECRET_KEY, algorithm="HS256")


def verify_sso_ticket(ticket: str, expected_app: Optional[str] = None) -> Dict[str, Any]:
    claims = jwt.decode(ticket, settings.SSO_SECRET_KEY, algorithms=["HS256"], issuer="dtl-platform")
    if expected_app and claims.get("target_app") != expected_app:
        raise ValueError(f"Invalid target app: expected {expected_app}, got {claims.get('target_app')}")
    return claims

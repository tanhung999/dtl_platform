"""Require an explicit same-origin request for browser cookie mutations."""
from urllib.parse import urlsplit

from fastapi import Request
from starlette.responses import JSONResponse

from app.core.config import settings


def origin(value: str) -> tuple:
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError('Invalid origin')
    return parsed.scheme, parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == 'https' else 80)


async def protect_cookie_writes(request: Request, call_next):
    if request.method not in ('GET', 'HEAD', 'OPTIONS'):
        cookie = request.cookies.get(settings.OIDC_SESSION_COOKIE_NAME)
        login = settings.OIDC_ENABLED and request.url.path == '/api/auth/login'
        # Integration clients with bearer credentials do not use browser sessions.
        bearer = request.headers.get('authorization', '').lower().startswith('bearer ')
        if login or (cookie and not bearer):
            explicit_request = request.headers.get('x-platform-request') == '1'
            allowed = explicit_request
            supplied_origin = request.headers.get('origin')
            if supplied_origin is not None:
                try:
                    same_origin = origin(supplied_origin) == origin(settings.OIDC_FRONTEND_URL)
                    # The production frontend already sends JSON. Allow its open tabs
                    # during rollout only when the browser supplies the exact trusted
                    # Origin; HTML forms and requests without Origin still need the header.
                    json_request = request.headers.get('content-type', '').split(';', 1)[0].strip().lower() == 'application/json'
                    allowed = same_origin and (explicit_request or json_request)
                except ValueError:
                    allowed = False
            allowed = allowed and request.headers.get('sec-fetch-site') != 'cross-site'
            if not allowed:
                return JSONResponse(status_code=403, content={'detail': 'Yêu cầu không hợp lệ. Hãy tải lại trang và thử lại.'})
    return await call_next(request)

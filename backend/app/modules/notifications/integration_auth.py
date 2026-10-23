"""Xác thực máy chủ tích hợp; giới hạn kích thước trước khi đọc JSON."""
import hashlib
import hmac
import re
import time
from fastapi import HTTPException


async def signed_body(request, secret, source, *, purpose=None):
    if len(secret) < 32:
        raise HTTPException(503, 'Nguồn thông báo này chưa được kết nối.')
    timestamp = request.headers.get('X-Notification-Timestamp', '')
    try:
        if len(timestamp) > 12 or abs(time.time() - int(timestamp)) > 300:
            raise ValueError()
    except ValueError:
        raise HTTPException(401, 'Chữ ký thông báo hết hạn hoặc không hợp lệ.')
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 16384:
            raise HTTPException(413, 'Nội dung thông báo quá lớn.')
    context = timestamp + '\n' + source + '\n' + (purpose + '\n' if purpose else '')
    signature = 'sha256=' + hmac.new(secret.encode(), context.encode() + body, hashlib.sha256).hexdigest()
    supplied = request.headers.get('X-Notification-Signature', '')
    if not re.fullmatch(r'sha256=[0-9a-f]{64}', supplied) or not hmac.compare_digest(signature, supplied):
        raise HTTPException(401, 'Chữ ký thông báo không hợp lệ.')
    return bytes(body)

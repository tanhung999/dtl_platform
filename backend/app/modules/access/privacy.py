"""Chỉ tài khoản có quyền chia sẻ lịch được đổi trạng thái riêng tư."""
from .service import SHARE, require


async def require_privacy_change(db, user_id, value, previous=False):
    if value != previous:
        await require(db, user_id, SHARE)

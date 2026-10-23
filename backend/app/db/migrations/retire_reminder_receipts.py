"""Bỏ receipt của nhắc tự động đã ngừng; giữ nguyên hộp thông báo và job hiện tại."""
from sqlalchemy import text


async def migrate_retire_reminder_receipts(conn):
    await conn.execute(text('DROP TABLE IF EXISTS task_reminder_receipts'))

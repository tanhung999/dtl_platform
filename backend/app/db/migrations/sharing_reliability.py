"""Giữ phiên bản quyền đã thu hồi, bổ sung nhật ký và phiên bản phân quyền."""
from sqlalchemy import inspect, text

async def migrate_sharing_reliability(conn):
    columns = await conn.run_sync(lambda c: {row['name'] for row in inspect(c).get_columns('calendar_shares')})
    if 'revoked_at' not in columns:
        await conn.execute(text('ALTER TABLE calendar_shares ADD COLUMN revoked_at TIMESTAMP WITH TIME ZONE'))

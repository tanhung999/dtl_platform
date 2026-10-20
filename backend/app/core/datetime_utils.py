"""Chuẩn hóa timestamp đọc từ database trước khi trả ra API.

Ứng dụng lưu thời điểm theo UTC. SQLite bỏ tzinfo khi đọc DateTime,
nên giá trị naive từ database được hiểu là UTC, không phải giờ máy chủ.
Không dùng hàm này để chấp nhận đầu vào ngày giờ thiếu múi giờ.
"""
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any


def database_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.utcoffset() is None else value.astimezone(timezone.utc)


def utc_mapping(row: Mapping[str, Any]) -> dict[str, Any]:
    return {key: database_utc(value) if isinstance(value, datetime) else value for key, value in row.items()}
